import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import {
  NAVER_PLACE_CACHE_MAX_SIZE,
  NAVER_PLACE_CACHE_TTL_MS,
  NAVER_PLACE_REQUEST_TIMEOUT_MS,
  NAVER_PLACE_USER_AGENT,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";
import {
  NAVER_BOOKING_DEFAULT_BUSINESS_TYPE_ID,
  NAVER_BOOKING_ERROR_MESSAGES,
  NAVER_BOOKING_ID_REGEX,
  NAVER_BOOKING_ITEMS_ENDPOINT,
  NAVER_BOOKING_ITEMS_QUERY,
  NAVER_BOOKING_OPTION_QUERY,
  NAVER_BOOKING_PORTA_ENDPOINT,
  NAVER_BOOKING_SCHEDULE_LOOKAHEAD_DAYS,
  NAVER_BOOKING_SCHEDULE_QUERY,
  NAVER_IMAGE_MAX_BYTES,
} from "@apps/backend/modules/naver-place/constants/naver-booking.constants";
import {
  NaverBookingItem,
  NaverBookingOption,
  parseNaverBookingItems,
  parseNaverBookingOptions,
  pickNaverBookingSlot,
  toNaverImageUrl,
} from "@apps/backend/modules/naver-place/utils/naver-booking-parser.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";

type CacheEntry<T> = { expiresAt: number; fetchedAt: Date; value: T };

/**
 * 네이버 예약 상품·옵션 조회 서비스
 *
 * 네이버 예약 모바일 화면과 같은 GraphQL 요청으로 읽는다. 요청 주소는 고정된 네이버 주소이고,
 * 업체·상품 ID는 숫자만 받는다. 같은 업체·상품은 10분 동안 다시 읽지 않는다.
 */
@Injectable()
export class NaverBookingService {
  private readonly axiosInstance: AxiosInstance;
  private readonly itemsCache = new Map<string, CacheEntry<NaverBookingItem[]>>();
  private readonly optionsCache = new Map<string, CacheEntry<NaverBookingOption[] | null>>();

  constructor() {
    this.axiosInstance = axios.create({
      timeout: NAVER_PLACE_REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": NAVER_PLACE_USER_AGENT,
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * 네이버 예약 업체의 상품 목록 (손님에게 보이는 상품만)
   */
  async listItems(businessId: string): Promise<{ items: NaverBookingItem[]; fetchedAt: Date }> {
    this.assertId(businessId);
    const cached = this.getCached(this.itemsCache, businessId);
    if (cached) return { items: cached.value, fetchedAt: cached.fetchedAt };

    const data = await this.post(
      NAVER_BOOKING_ITEMS_ENDPOINT,
      {
        operationName: "bizItems",
        variables: {
          input: { businessId, lang: "ko", projections: "RESOURCE", isImp: true },
        },
        query: NAVER_BOOKING_ITEMS_QUERY,
      },
      "fetch-booking-items",
      { businessId },
    );
    const items = parseNaverBookingItems(data);
    const fetchedAt = this.setCached(this.itemsCache, businessId, items);
    return { items, fetchedAt };
  }

  /**
   * 상품 1개의 옵션. 옵션은 예약 시간을 하나 정해야 나오므로 가장 이른 예약 가능 시간으로 읽는다.
   * 예약 가능한 시간이 없으면 null(옵션을 알 수 없음)을 돌려준다.
   */
  async getItemOptions(
    businessId: string,
    bizItemId: string,
    businessTypeId: number | null,
  ): Promise<NaverBookingOption[] | null> {
    this.assertId(businessId);
    this.assertId(bizItemId);
    const key = `${businessId}:${bizItemId}`;
    const cached = this.getCached(this.optionsCache, key);
    if (cached) return cached.value;

    const today = this.kstToday();
    const end = new Date(today.getTime() + NAVER_BOOKING_SCHEDULE_LOOKAHEAD_DAYS * 86_400_000);
    const scheduleData = await this.post(
      NAVER_BOOKING_PORTA_ENDPOINT,
      {
        operationName: "HourlySchedule",
        variables: {
          input: {
            businessTypeId: businessTypeId ?? NAVER_BOOKING_DEFAULT_BUSINESS_TYPE_ID,
            businessId,
            bizItemId,
            startDateTime: `${this.ymd(today)}T00:00:00`,
            endDateTime: `${this.ymd(end)}T23:59:59`,
            fixedTime: true,
            includesHolidaySchedules: true,
          },
        },
        query: NAVER_BOOKING_SCHEDULE_QUERY,
      },
      "fetch-booking-schedule",
      { businessId, bizItemId },
    );

    const slot = pickNaverBookingSlot(scheduleData);
    if (!slot) {
      this.setCached(this.optionsCache, key, null);
      return null;
    }

    const optionData = await this.post(
      NAVER_BOOKING_PORTA_ENDPOINT,
      {
        operationName: "Option",
        variables: {
          input: {
            businessId,
            bizItemId,
            slotId: slot.slotId,
            scheduleId: slot.scheduleId,
            startDate: slot.startDate,
            lang: "ko",
          },
        },
        query: NAVER_BOOKING_OPTION_QUERY,
      },
      "fetch-booking-options",
      { businessId, bizItemId },
    );
    const options = parseNaverBookingOptions(optionData);
    this.setCached(this.optionsCache, key, options);
    return options;
  }

  /**
   * 네이버 이미지 서버에서 사진 1장을 받습니다. 주소는 네이버에서 읽은 상품 사진만 넘어옵니다.
   */
  async downloadImage(imageUrl: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const safeUrl = toNaverImageUrl(imageUrl);
    if (!safeUrl) throw new BadRequestException(NAVER_BOOKING_ERROR_MESSAGES.IMAGE_NOT_FOUND);
    const parsed = new URL(safeUrl);
    // 검증한 호스트·경로로 주소를 다시 만든다 (리다이렉트는 따라가지 않음)
    const requestUrl = `https://${parsed.hostname}${parsed.pathname}${parsed.search}`;
    try {
      const response = await this.axiosInstance.get<ArrayBuffer>(requestUrl, {
        responseType: "arraybuffer",
        maxRedirects: 0,
        maxContentLength: NAVER_IMAGE_MAX_BYTES,
        headers: { Accept: "image/*" },
      });
      const mimetype = String(response.headers["content-type"] ?? "")
        .split(";")[0]
        .trim();
      return { buffer: Buffer.from(response.data), mimetype };
    } catch (error: any) {
      this.reportFailure("download-image", error, { host: parsed.hostname });
      throw new BadGatewayException(NAVER_BOOKING_ERROR_MESSAGES.IMAGE_FAILED);
    }
  }

  private async post(
    url: string,
    body: Record<string, unknown>,
    operation: string,
    details: Record<string, string>,
  ): Promise<unknown> {
    try {
      const response = await this.axiosInstance.post(url, body, {
        headers: { Referer: "https://m.booking.naver.com/", Origin: "https://m.booking.naver.com" },
      });
      const data = response.data as any;
      if (Array.isArray(data?.errors) && data.errors.length > 0 && !data?.data) {
        throw Object.assign(new Error(String(data.errors[0]?.message ?? "GraphQL error")), {
          graphqlErrors: data.errors,
        });
      }
      return data;
    } catch (error: any) {
      this.reportFailure(operation, error, details);
      throw new BadGatewayException(NAVER_BOOKING_ERROR_MESSAGES.FETCH_FAILED);
    }
  }

  private assertId(value: string): void {
    if (!NAVER_BOOKING_ID_REGEX.test(value)) {
      throw new BadRequestException(NAVER_BOOKING_ERROR_MESSAGES.INVALID_ITEM);
    }
  }

  private getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> | null {
    const entry = cache.get(key);
    return entry && entry.expiresAt > Date.now() ? entry : null;
  }

  private setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): Date {
    if (cache.size >= NAVER_PLACE_CACHE_MAX_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    const fetchedAt = new Date();
    cache.set(key, { expiresAt: fetchedAt.getTime() + NAVER_PLACE_CACHE_TTL_MS, fetchedAt, value });
    return fetchedAt;
  }

  /** 한국 시간 기준 오늘 0시 (UTC Date) */
  private kstToday(): Date {
    const kst = new Date(Date.now() + 9 * 3_600_000);
    return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  }

  private ymd(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private reportFailure(operation: string, error: any, details: Record<string, string>): void {
    ExternalApiErrorUtil.reportFailure(
      {
        provider: "naver-booking",
        module: "naver-place",
        operation,
        ...ExternalApiErrorUtil.fromAxiosError(error ?? {}),
        details,
      },
      error,
    );
  }
}
