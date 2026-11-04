import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import {
  NAVER_PLACE_CACHE_MAX_SIZE,
  NAVER_PLACE_CACHE_TTL_MS,
  NAVER_PLACE_ERROR_MESSAGES,
  NAVER_PLACE_REQUEST_TIMEOUT_MS,
  NAVER_PLACE_USER_AGENT,
  NAVER_SHORT_URL_MAX_REDIRECTS,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";
import {
  extractNaverPlaceId,
  extractNaverShortCode,
  NAVER_PLACE_ID_REGEX,
} from "@apps/backend/modules/naver-place/utils/naver-place-url.util";
import {
  extractApolloState,
  NaverPlaceInfo,
  parseNaverPlace,
} from "@apps/backend/modules/naver-place/utils/naver-place-parser.util";
import {
  mapNaverBusinessHours,
  toStorePrefill,
} from "@apps/backend/modules/naver-place/utils/naver-place-store-prefill.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { NaverPlacePreviewResponseDto } from "@apps/backend/modules/naver-place/dto/naver-place-preview.dto";

/**
 * 네이버 플레이스 매장 정보 조회 서비스
 * 판매자가 붙여 넣은 네이버 플레이스 링크로 매장 1건을 조회해 스토어 입력값으로 바꿉니다.
 */
@Injectable()
export class NaverPlaceService {
  private readonly axiosInstance: AxiosInstance;
  private readonly cache = new Map<
    string,
    { expiresAt: number; fetchedAt: Date; info: NaverPlaceInfo }
  >();

  constructor() {
    this.axiosInstance = axios.create({
      timeout: NAVER_PLACE_REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": NAVER_PLACE_USER_AGENT,
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });
  }

  /**
   * 네이버 플레이스 링크로 매장 정보와 스토어 폼에 채울 값을 조회합니다.
   * 화면에 필요한 값만 돌려줍니다(사진·리뷰·메뉴는 보내지 않음).
   */
  async preview(url: string): Promise<NaverPlacePreviewResponseDto> {
    const placeId = await this.resolvePlaceId(url);
    const { info, fetchedAt } = await this.getPlaceInfo(placeId);
    const { storePrefill, warnings } = toStorePrefill(info);
    return {
      placeId,
      placeUrl: info.placeUrl,
      category: info.category,
      fetchedAt: fetchedAt.toISOString(),
      storePrefill,
      businessHours: {
        days: info.businessHours.days.map((d) => ({
          day: d.day,
          open: d.open,
          close: d.close,
          endsNextDay: d.endsNextDay,
          breakHours: d.breakHours,
          description: d.description,
        })),
        freeText: info.businessHours.freeText,
      },
      calendarSuggestion: mapNaverBusinessHours(info),
      warnings,
    };
  }

  /**
   * 링크에서 플레이스 ID를 찾습니다. 단축 링크(naver.me)는 리다이렉트를 따라갑니다.
   */
  private async resolvePlaceId(url: string): Promise<string> {
    let current = url.trim();
    for (let i = 0; i <= NAVER_SHORT_URL_MAX_REDIRECTS; i++) {
      const placeId = extractNaverPlaceId(current);
      if (placeId) return placeId;
      // 단축 링크만 따라간다 (다른 도메인으로는 요청하지 않음)
      const shortCode = extractNaverShortCode(current);
      if (!shortCode) break;

      const location = await this.fetchShortUrlRedirect(shortCode);
      if (!location) break;
      current = new URL(location, current).toString();
    }
    throw new BadRequestException(NAVER_PLACE_ERROR_MESSAGES.INVALID_URL);
  }

  /**
   * 단축 링크의 리다이렉트 응답에서 Location 헤더만 읽습니다.
   * 요청 주소는 고정된 naver.me 주소와 검증한 코드로만 만듭니다.
   */
  private async fetchShortUrlRedirect(shortCode: string): Promise<string | null> {
    const url = `https://naver.me/${encodeURIComponent(shortCode)}`;
    try {
      const response = await this.axiosInstance.get(url, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 300 && status < 400,
      });
      const location = response.headers.location;
      return typeof location === "string" ? location : null;
    } catch {
      return null;
    }
  }

  /**
   * 플레이스 상세 페이지를 받아 파싱합니다. 같은 플레이스는 일정 시간 캐시합니다.
   */
  private async getPlaceInfo(placeId: string): Promise<{ info: NaverPlaceInfo; fetchedAt: Date }> {
    const cached = this.cache.get(placeId);
    if (cached && cached.expiresAt > Date.now()) {
      return { info: cached.info, fetchedAt: cached.fetchedAt };
    }

    const html = await this.fetchPlaceHtml(placeId);
    const state = extractApolloState(html);
    if (!state) {
      this.reportFailure("parse-apollo-state", placeId, new Error("APOLLO_STATE not found"));
      throw new BadGatewayException(NAVER_PLACE_ERROR_MESSAGES.PARSE_FAILED);
    }

    const info = parseNaverPlace(state, placeId);
    if (!info) throw new NotFoundException(NAVER_PLACE_ERROR_MESSAGES.NOT_FOUND);

    if (this.cache.size >= NAVER_PLACE_CACHE_MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    const fetchedAt = new Date();
    this.cache.set(placeId, {
      expiresAt: fetchedAt.getTime() + NAVER_PLACE_CACHE_TTL_MS,
      fetchedAt,
      info,
    });
    return { info, fetchedAt };
  }

  /**
   * 플레이스 상세 페이지(모바일)를 받습니다. 업종이 달라도 `/place/`로 요청하면 알맞은 경로로 리다이렉트됩니다.
   * 요청 주소는 고정된 네이버 주소와 숫자만 있는 플레이스 ID로만 만듭니다.
   */
  private async fetchPlaceHtml(placeId: string): Promise<string> {
    if (!NAVER_PLACE_ID_REGEX.test(placeId)) {
      throw new BadRequestException(NAVER_PLACE_ERROR_MESSAGES.INVALID_URL);
    }
    const url = `https://m.place.naver.com/place/${encodeURIComponent(placeId)}/home`;
    try {
      const response = await this.axiosInstance.get<string>(url, { responseType: "text" });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new NotFoundException(NAVER_PLACE_ERROR_MESSAGES.NOT_FOUND);
      }
      this.reportFailure("fetch-place-home", placeId, error);
      throw new BadGatewayException(NAVER_PLACE_ERROR_MESSAGES.FETCH_FAILED);
    }
  }

  private reportFailure(operation: string, placeId: string, error: any): void {
    ExternalApiErrorUtil.reportFailure(
      {
        provider: "naver-place",
        module: "naver-place",
        operation,
        ...ExternalApiErrorUtil.fromAxiosError(error ?? {}),
        details: { placeId },
      },
      error,
    );
  }
}
