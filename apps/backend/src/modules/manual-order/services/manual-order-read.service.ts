import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { DailyQuota } from "@apps/backend/common/utils/daily-quota.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { koreaCalendarYmd } from "@apps/backend/modules/order/utils/order-list-query.util";
import { parseImageDataUrl } from "@apps/backend/modules/quote-request/utils/quote-photo-read.util";
import {
  MANUAL_ORDER_ERROR_MESSAGES,
  MANUAL_ORDER_READ_ERROR_MESSAGES,
  MANUAL_ORDER_READ_LIMITS,
  MANUAL_ORDER_READ_MODEL,
} from "@apps/backend/modules/manual-order/constants/manual-order.constants";
import {
  clipConversation,
  readOrderConversation,
  type ManualOrderReadResult,
} from "@apps/backend/modules/manual-order/utils/manual-order-read.util";
import { ymdDayDiff } from "@apps/backend/modules/manual-order/utils/manual-order-date.util";

const DAILY_TOTAL_NOTICE_INTERVAL_MS = 6 * 3_600_000;
const CLAUDE_REJECTED_NOTICE_INTERVAL_MS = 3_600_000;

/**
 * 대화 붙여 넣어 채우기(기획 I-42): 사장님이 붙여 넣은 주문 대화 글이나 대화 캡처를 Claude가 읽어 주문 적기 칸을 채울 값을 준다.
 *
 * - 대화·캡처는 저장하지 않는다. 로그에는 횟수·시간·토큰만 남기고 대화·읽은 내용은 남기지 않는다.
 * - 하루 60번(사장님마다), 모든 사장님을 합쳐 하루 2,000번(넘으면 503). 분당 한도는 컨트롤러(@Throttle)가 막는다.
 * - Claude는 20초까지만 기다리고 다시 시도하지 않는다. 우리 쪽 실패(연결·시간 초과·429·5xx)는 한도에서 되돌린다.
 * - 견적 사진 읽기(I-112)와 같은 키(ANTHROPIC_API_KEY)·같은 방식이다.
 */
@Injectable()
export class ManualOrderReadService {
  private readonly client: Anthropic | null;
  private readonly quota = new DailyQuota(MANUAL_ORDER_READ_LIMITS.DAILY_PER_SELLER);
  private readonly totalQuota = new DailyQuota(MANUAL_ORDER_READ_LIMITS.DAILY_TOTAL);

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = configService.get<string>("ANTHROPIC_API_KEY");
    this.client = apiKey
      ? new Anthropic({
          apiKey,
          maxRetries: 0,
          timeout: MANUAL_ORDER_READ_LIMITS.CLAUDE_TIMEOUT_MS,
        })
      : null;
  }

  async read(
    sellerId: string,
    storeId: string,
    input: { text?: string; image?: string; today?: string },
  ): Promise<ManualOrderReadResult> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, sellerId },
      select: { name: true },
    });
    if (!store) throw new ForbiddenException(MANUAL_ORDER_ERROR_MESSAGES.STORE_NOT_OWNED);

    // 글이 있으면 글, 없으면 캡처
    const text = typeof input.text === "string" ? clipConversation(input.text) : "";
    let source:
      | { kind: "text"; text: string }
      | { kind: "image"; mediaType: "image/jpeg" | "image/png"; data: string };
    if (text) {
      source = { kind: "text", text };
    } else if (input.image) {
      const parsed = parseImageDataUrl(input.image);
      if (!parsed.ok) throw new BadRequestException(MANUAL_ORDER_READ_ERROR_MESSAGES[parsed.error]);
      source = { kind: "image", mediaType: parsed.mediaType, data: parsed.data };
    } else {
      throw new BadRequestException(MANUAL_ORDER_READ_ERROR_MESSAGES.EMPTY);
    }

    if (!this.client) {
      throw new ServiceUnavailableException(MANUAL_ORDER_READ_ERROR_MESSAGES.UNAVAILABLE);
    }

    const key = `seller:${sellerId}`;
    if (!this.quota.tryConsume(key)) {
      throw new HttpException(
        {
          message: MANUAL_ORDER_READ_ERROR_MESSAGES.DAILY_LIMIT,
          error: "Too Many Requests",
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.totalQuota.tryConsume("all")) {
      this.quota.refund(key);
      SentryUtil.captureExceptionThrottled(
        "manual-order-read:daily-total",
        DAILY_TOTAL_NOTICE_INTERVAL_MS,
        new Error(`대화 읽기 오늘 전체 한도(${MANUAL_ORDER_READ_LIMITS.DAILY_TOTAL}번)에 닿음`),
        "warning",
        { module: "manual-order", operation: "read" },
      );
      throw new ServiceUnavailableException(MANUAL_ORDER_READ_ERROR_MESSAGES.UNAVAILABLE);
    }

    // 휴대폰 날짜가 서버 날짜와 하루 넘게 다르면 서버 날짜(한국 시간)를 쓴다
    const serverToday = koreaCalendarYmd(new Date());
    const today =
      input.today && Math.abs(ymdDayDiff(serverToday, input.today)) <= 1
        ? input.today
        : serverToday;

    const startedAt = Date.now();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), MANUAL_ORDER_READ_LIMITS.CLAUDE_TIMEOUT_MS);
    let generation;
    try {
      generation = await readOrderConversation(
        this.client,
        MANUAL_ORDER_READ_MODEL,
        source,
        { today, storeName: store.name },
        { signal: deadline.signal },
      );
    } catch (error: any) {
      const status: number | undefined = error?.status;
      // Claude가 캡처를 받지 않음(깨진 사진 등 400): 사장님 쪽 문제라 횟수를 세고 400으로.
      // 대화 글의 4xx와 401·403·404(키·권한·모델)는 우리 쪽 문제라 아래에서 되돌리고 502로 알린다
      if (!deadline.signal.aborted && source.kind === "image" && status === 400) {
        SentryUtil.captureExceptionThrottled(
          "manual-order-read:claude-4xx",
          CLAUDE_REJECTED_NOTICE_INTERVAL_MS,
          error,
          "warning",
          { module: "manual-order", operation: "read" },
          { httpStatus: status, providerError: error?.error?.error?.type },
        );
        throw new BadRequestException(MANUAL_ORDER_READ_ERROR_MESSAGES.INVALID_IMAGE);
      }
      this.quota.refund(key);
      this.totalQuota.refund("all");
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "anthropic",
          module: "manual-order",
          operation: "read",
          httpStatus: error?.status,
          providerError: error?.error?.error?.type,
          details: {
            model: MANUAL_ORDER_READ_MODEL,
            kind: source.kind,
            timedOut: deadline.signal.aborted,
            ms: Date.now() - startedAt,
          },
        },
        error,
      );
      throw new BadGatewayException(MANUAL_ORDER_READ_ERROR_MESSAGES.FAILED);
    } finally {
      clearTimeout(timer);
    }

    // 비용을 볼 수 있게 사용량만 남긴다(대화·캡처·읽은 내용은 남기지 않음)
    LoggerUtil.log(
      `대화 읽기: kind=${source.kind} model=${generation.model} stop=${generation.stopReason} in=${generation.usage.inputTokens} out=${generation.usage.outputTokens} ms=${Date.now() - startedAt} found=${generation.result.found}`,
    );
    return generation.result;
  }
}
