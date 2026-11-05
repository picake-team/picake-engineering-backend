import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import {
  NAVER_PLACE_CACHE_MAX_SIZE,
  NAVER_PLACE_CACHE_TTL_MS,
  NAVER_PLACE_REQUEST_TIMEOUT_MS,
  NAVER_PLACE_USER_AGENT,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";
import {
  NAVER_BOOKING_DAILY_SCHEDULE_QUERY,
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
  NaverBookingOptionsResult,
  parseNaverBookingItems,
  parseNaverBookingOptions,
  pickNaverBookingDate,
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
  private readonly optionsCache = new Map<string, CacheEntry<NaverBookingOptionsResult>>();

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
   * 상품 1개의 옵션. 옵션은 예약 날짜(시간)를 하나 정해야 나오므로 가장 이른 예약 가능 날짜로 읽는다.
   * 네이버 예약은 업종마다 방식이 달라 시간 단위(식당·픽업)와 날짜 단위(새 예약 방식) 둘 다 시도한다.
   * - OK: 옵션을 읽음 / NO_SCHEDULE: 예약 가능한 날이 없음 / FAILED: 네이버가 옵션 요청을 받지 않음(프랜차이즈 주문 등)
   * 옵션을 못 읽어도 상품 정보는 쓸 수 있으므로 예외를 던지지 않는다.
   */
  async getItemOptions(
    businessId: string,
    bizItemId: string,
    businessTypeId: number | null,
  ): Promise<NaverBookingOptionsResult> {
    this.assertId(businessId);
    this.assertId(bizItemId);
    const key = `${businessId}:${bizItemId}`;
    const cached = this.getCached(this.optionsCache, key);
    if (cached) return cached.value;

    const typeId = businessTypeId ?? NAVER_BOOKING_DEFAULT_BUSINESS_TYPE_ID;
    const order: ("hourly" | "daily")[] =
      typeId === NAVER_BOOKING_DEFAULT_BUSINESS_TYPE_ID ? ["hourly", "daily"] : ["daily", "hourly"];

    let sawSchedule = false;
    let optionFailed = false;
    for (const mode of order) {
      const input = await this.findOptionInput(mode, businessId, bizItemId, typeId).catch(
        () => undefined,
      );
      if (input === undefined) continue; // 이 방식은 안 됨
      sawSchedule = true;
      if (input === null) continue; // 예약 가능한 날이 없음
      try {
        const data = await this.post(
          NAVER_BOOKING_PORTA_ENDPOINT,
          { operationName: "Option", variables: { input }, query: NAVER_BOOKING_OPTION_QUERY },
          "fetch-booking-options",
          { businessId, bizItemId, mode },
          false,
        );
        const result: NaverBookingOptionsResult = {
          options: parseNaverBookingOptions(data),
          status: "OK",
        };
        this.setCached(this.optionsCache, key, result);
        return result;
      } catch {
        // 다른 방식으로 한 번 더 시도한다
        optionFailed = true;
      }
    }

    const result: NaverBookingOptionsResult = {
      options: null,
      // 일정은 있는데 옵션 요청이 막혔으면 FAILED, 일정 자체가 없으면 NO_SCHEDULE
      status: optionFailed || !sawSchedule ? "FAILED" : "NO_SCHEDULE",
    };
    // 실패는 캐시하지 않는다 (잠시 뒤 다시 시도할 수 있게). 형식이 바뀐 것일 수 있어 한 번 알린다
    if (result.status === "NO_SCHEDULE") this.setCached(this.optionsCache, key, result);
    else
      this.reportFailure("options-unavailable", new Error("all option paths failed"), {
        businessId,
        bizItemId,
        typeId: String(typeId),
      });
    return result;
  }

  /**
   * 옵션 요청에 넣을 예약 날짜를 찾는다.
   * undefined: 이 방식으로는 일정을 읽지 못함 / null: 예약 가능한 날이 없음
   */
  private async findOptionInput(
    mode: "hourly" | "daily",
    businessId: string,
    bizItemId: string,
    typeId: number,
  ): Promise<Record<string, unknown> | null | undefined> {
    const today = this.kstToday();
    const end = new Date(today.getTime() + NAVER_BOOKING_SCHEDULE_LOOKAHEAD_DAYS * 86_400_000);

    if (mode === "hourly") {
      const data = await this.post(
        NAVER_BOOKING_PORTA_ENDPOINT,
        {
          operationName: "HourlySchedule",
          variables: {
            input: {
              businessTypeId: typeId,
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
        false,
      );
      if (!Array.isArray((data as any)?.data?.hourlySchedule)) return undefined;
      const slot = pickNaverBookingSlot(data);
      if (!slot) return null;
      return {
        businessId,
        bizItemId,
        slotId: slot.slotId,
        scheduleId: slot.scheduleId,
        startDate: slot.startDate,
        lang: "ko",
      };
    }

    const data = await this.post(
      NAVER_BOOKING_PORTA_ENDPOINT,
      {
        operationName: "TimeSlotAvailabilityDailySummaries",
        variables: {
          input: { businessId, bizItemId, startDate: this.ymd(today), endDate: this.ymd(end) },
        },
        query: NAVER_BOOKING_DAILY_SCHEDULE_QUERY,
      },
      "fetch-booking-daily-schedule",
      { businessId, bizItemId },
      false,
    );
    if (!Array.isArray((data as any)?.data?.timeSlotAvailabilityDailySummaries)) return undefined;
    const date = pickNaverBookingDate(data);
    if (!date) return null;
    return {
      businessId,
      bizItemId,
      startDate: date,
      endDate: date,
      lang: "ko",
      businessTypeId: typeId,
    };
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
    report = true,
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
      // 다른 방식으로 다시 시도하는 요청은 실패해도 알리지 않는다
      if (report) this.reportFailure(operation, error, details);
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
