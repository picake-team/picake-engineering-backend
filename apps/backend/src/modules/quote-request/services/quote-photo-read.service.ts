import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { ipQuotaKey } from "@apps/backend/common/utils/client-ip.util";
import { DailyQuota } from "@apps/backend/common/utils/daily-quota.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import {
  QUOTE_PHOTO_READ_ERROR_MESSAGES,
  QUOTE_PHOTO_READ_LIMITS,
  QUOTE_PHOTO_READ_MODEL,
} from "@apps/backend/modules/quote-request/constants/quote-photo-read.constants";
import {
  parseImageDataUrl,
  readCakePhoto,
  type QuotePhotoReadResponse,
} from "@apps/backend/modules/quote-request/utils/quote-photo-read.util";

/** 오늘 전체 한도에 닿았다고 Sentry에 알리는 간격(공격이 이어져도 몇 번만) */
const DAILY_TOTAL_NOTICE_INTERVAL_MS = 6 * 3_600_000;
/** Claude가 사진을 받지 않았다고(4xx) Sentry에 알리는 간격 */
const CLAUDE_REJECTED_NOTICE_INTERVAL_MS = 3_600_000;

/**
 * 견적 요청서 참고 사진 읽기(기획 I-112 1-나 / I-46 ③, Claude).
 *
 * - 손님이 올린 케이크 사진에서 보이는 것만 읽어 요청서 칸(설명·크기·크림·요청 사항)을 채울 값을 준다. 손님이 고친 뒤 보낸다.
 * - 사진은 저장하지 않는다. 로그에는 횟수·시간·토큰만 남기고 사진·읽은 내용은 남기지 않는다.
 * - 로그인 전에도 쓴다(요청서를 먼저 쓰고 보낼 때 로그인). 하루 20번: 로그인하면 손님마다, 아니면 접속 주소마다(IPv6는 /64마다).
 *   모든 손님을 합쳐 하루 1,000번까지(넘으면 키가 없을 때와 같은 503). 분당 한도는 컨트롤러(@Throttle)가 막는다.
 * - Claude는 20초까지만 기다리고 다시 시도하지 않는다(웹은 30초 기다림). 연결·시간 초과·429·5xx는 두 한도 모두에서 되돌리고,
 *   Claude가 사진을 받지 않은 4xx(깨진 사진 등)는 횟수를 세고 400 "JPG나 PNG 사진만…"으로 답한다(11-14 상용 전 검토).
 * - 상세 설명 AI 초안(P-62)과 같은 Claude 키(ANTHROPIC_API_KEY)·같은 방식(메모리 하루 한도)을 쓴다.
 */
@Injectable()
export class QuotePhotoReadService {
  private readonly client: Anthropic | null;
  private readonly quota = new DailyQuota(QUOTE_PHOTO_READ_LIMITS.DAILY_PER_CLIENT);
  private readonly totalQuota = new DailyQuota(QUOTE_PHOTO_READ_LIMITS.DAILY_TOTAL);

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>("ANTHROPIC_API_KEY");
    this.client = apiKey
      ? new Anthropic({
          apiKey,
          // 다시 시도하면 웹이 기다리는 30초를 넘길 수 있다. 실패하면 손님이 다시 누르거나 직접 적는다
          maxRetries: 0,
          timeout: QUOTE_PHOTO_READ_LIMITS.CLAUDE_TIMEOUT_MS,
        })
      : null;
  }

  async read(
    image: string,
    who: { consumerId?: string | null; ip?: string | null },
  ): Promise<QuotePhotoReadResponse> {
    if (!this.client) {
      throw new ServiceUnavailableException(QUOTE_PHOTO_READ_ERROR_MESSAGES.UNAVAILABLE);
    }
    const parsed = parseImageDataUrl(image);
    if (!parsed.ok) {
      throw new BadRequestException(QUOTE_PHOTO_READ_ERROR_MESSAGES[parsed.error]);
    }

    const key = who.consumerId ? `consumer:${who.consumerId}` : `ip:${ipQuotaKey(who.ip)}`;
    if (!this.quota.tryConsume(key)) {
      // 다른 오류처럼 data.message에 글이 오게(분당 한도의 429와 글로 구분한다)
      throw new HttpException(
        {
          message: QUOTE_PHOTO_READ_ERROR_MESSAGES.DAILY_LIMIT,
          error: "Too Many Requests",
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.totalQuota.tryConsume("all")) {
      // 이 손님 몫은 쓰지 않았으니 되돌린다
      this.quota.refund(key);
      SentryUtil.captureExceptionThrottled(
        "quote-photo-read:daily-total",
        DAILY_TOTAL_NOTICE_INTERVAL_MS,
        new Error(`사진 읽기 오늘 전체 한도(${QUOTE_PHOTO_READ_LIMITS.DAILY_TOTAL}번)에 닿음`),
        "warning",
        { module: "quote-request", operation: "photo-read" },
      );
      LoggerUtil.log(`사진 읽기: 오늘 전체 한도(${QUOTE_PHOTO_READ_LIMITS.DAILY_TOTAL}번)에 닿음`);
      throw new ServiceUnavailableException(QUOTE_PHOTO_READ_ERROR_MESSAGES.UNAVAILABLE);
    }

    const startedAt = Date.now();
    // SDK의 timeout은 응답 머리를 받을 때까지만 잰다. 응답을 다 받을 때까지 같은 마감을 건다
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), QUOTE_PHOTO_READ_LIMITS.CLAUDE_TIMEOUT_MS);
    let generation;
    try {
      generation = await readCakePhoto(this.client, QUOTE_PHOTO_READ_MODEL, parsed, {
        signal: deadline.signal,
      });
    } catch (error: any) {
      const status: number | undefined = error?.status;
      // Claude가 사진을 받지 않음(깨진 사진 등 4xx, 한도 429 제외): 손님 사진 문제라 횟수를 세고 400으로 답한다.
      // 로그인 없이 부를 수 있어 되돌리면 같은 사진으로 끝없이 부를 수 있고, Sentry도 몇 번만 알린다
      if (!deadline.signal.aborted && status && status >= 400 && status < 500 && status !== 429) {
        SentryUtil.captureExceptionThrottled(
          "quote-photo-read:claude-4xx",
          CLAUDE_REJECTED_NOTICE_INTERVAL_MS,
          error,
          "warning",
          { module: "quote-request", operation: "photo-read" },
          { httpStatus: status, providerError: error?.error?.error?.type },
        );
        throw new BadRequestException(QUOTE_PHOTO_READ_ERROR_MESSAGES.INVALID_IMAGE);
      }
      // 우리 쪽(연결·시간 초과·Claude 한도·서버 오류) 문제로 못 읽었으면 두 한도 모두 되돌린다
      this.quota.refund(key);
      this.totalQuota.refund("all");
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "anthropic",
          module: "quote-request",
          operation: "photo-read",
          httpStatus: error?.status,
          providerError: error?.error?.error?.type,
          details: {
            model: QUOTE_PHOTO_READ_MODEL,
            timedOut: deadline.signal.aborted,
            ms: Date.now() - startedAt,
          },
        },
        error,
      );
      throw new BadGatewayException(QUOTE_PHOTO_READ_ERROR_MESSAGES.FAILED);
    } finally {
      clearTimeout(timer);
    }

    // 비용을 볼 수 있게 사용량만 남긴다(사진·읽은 내용·접속 주소는 남기지 않음)
    LoggerUtil.log(
      `사진 읽기: model=${generation.model} stop=${generation.stopReason} in=${generation.usage.inputTokens} out=${generation.usage.outputTokens} ms=${Date.now() - startedAt} readable=${generation.result !== null} by=${who.consumerId ? "consumer" : "ip"}`,
    );
    return generation.result ?? { unreadable: true };
  }
}
