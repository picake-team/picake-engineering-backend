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
  NAVER_PLACE_HOME_URL,
  NAVER_PLACE_REQUEST_TIMEOUT_MS,
  NAVER_PLACE_USER_AGENT,
  NAVER_SHORT_URL_MAX_REDIRECTS,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";
import {
  extractNaverPlaceId,
  isNaverShortUrl,
} from "@apps/backend/modules/naver-place/utils/naver-place-url.util";
import {
  extractApolloState,
  NaverPlaceInfo,
  parseNaverPlace,
} from "@apps/backend/modules/naver-place/utils/naver-place-parser.util";
import { toStorePrefill } from "@apps/backend/modules/naver-place/utils/naver-place-store-prefill.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { NaverPlacePreviewResponseDto } from "@apps/backend/modules/naver-place/dto/naver-place-preview.dto";

/**
 * 네이버 플레이스 매장 정보 조회 서비스
 * 판매자가 붙여 넣은 네이버 플레이스 링크로 매장 1건을 조회해 스토어 입력값으로 바꿉니다.
 */
@Injectable()
export class NaverPlaceService {
  private readonly axiosInstance: AxiosInstance;
  private readonly cache = new Map<string, { expiresAt: number; info: NaverPlaceInfo }>();

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
   * 네이버 플레이스 링크로 매장 정보와 스토어 자동 채우기 값을 조회합니다.
   */
  async preview(url: string): Promise<NaverPlacePreviewResponseDto> {
    const placeId = await this.resolvePlaceId(url);
    const info = await this.getPlaceInfo(placeId);
    const { storePrefill, warnings } = toStorePrefill(info);
    return { placeId, storePrefill, warnings, naverPlace: info };
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
      if (!isNaverShortUrl(current)) break;

      const location = await this.fetchRedirectLocation(current);
      if (!location) break;
      current = new URL(location, current).toString();
    }
    throw new BadRequestException(NAVER_PLACE_ERROR_MESSAGES.INVALID_URL);
  }

  /**
   * 리다이렉트 응답의 Location 헤더만 읽습니다.
   */
  private async fetchRedirectLocation(url: string): Promise<string | null> {
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
  private async getPlaceInfo(placeId: string): Promise<NaverPlaceInfo> {
    const cached = this.cache.get(placeId);
    if (cached && cached.expiresAt > Date.now()) return cached.info;

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
    this.cache.set(placeId, { expiresAt: Date.now() + NAVER_PLACE_CACHE_TTL_MS, info });
    return info;
  }

  private async fetchPlaceHtml(placeId: string): Promise<string> {
    const url = NAVER_PLACE_HOME_URL.replace("{placeId}", placeId);
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
