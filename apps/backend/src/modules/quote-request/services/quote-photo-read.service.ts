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
import { DailyQuota } from "@apps/backend/common/utils/daily-quota.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
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

/**
 * 견적 요청서 참고 사진 읽기(기획 I-112 1-나 / I-46 ③, Claude).
 *
 * - 손님이 올린 케이크 사진에서 보이는 것만 읽어 요청서 칸(설명·크기·크림·요청 사항)을 채울 값을 준다. 손님이 고친 뒤 보낸다.
 * - 사진은 저장하지 않는다. 로그에는 횟수·시간·토큰만 남기고 사진·읽은 내용은 남기지 않는다.
 * - 로그인 전에도 쓴다(요청서를 먼저 쓰고 보낼 때 로그인). 하루 20번: 로그인하면 손님마다, 아니면 접속 주소마다.
 * - 상세 설명 AI 초안(P-62)과 같은 Claude 키(ANTHROPIC_API_KEY)·같은 방식(메모리 하루 한도)을 쓴다.
 */
@Injectable()
export class QuotePhotoReadService {
  private readonly client: Anthropic | null;
  private readonly quota = new DailyQuota(QUOTE_PHOTO_READ_LIMITS.DAILY_PER_CLIENT);

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>("ANTHROPIC_API_KEY");
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 }) : null;
  }

  async read(
    image: string,
    who: { consumerId?: string | null; ip?: string | null },
  ): Promise<QuotePhotoReadResponse> {
    if (!this.client) {
      throw new ServiceUnavailableException(QUOTE_PHOTO_READ_ERROR_MESSAGES.NOT_CONFIGURED);
    }
    const parsed = parseImageDataUrl(image);
    if (!parsed.ok) {
      throw new BadRequestException(QUOTE_PHOTO_READ_ERROR_MESSAGES[parsed.error]);
    }

    const key = who.consumerId ? `consumer:${who.consumerId}` : `ip:${who.ip || "unknown"}`;
    if (!this.quota.tryConsume(key)) {
      throw new HttpException(
        QUOTE_PHOTO_READ_ERROR_MESSAGES.DAILY_LIMIT,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const startedAt = Date.now();
    let generation;
    try {
      generation = await readCakePhoto(this.client, QUOTE_PHOTO_READ_MODEL, parsed);
    } catch (error: any) {
      // 우리 쪽(연결·Claude) 문제로 못 읽었으면 횟수를 되돌린다
      this.quota.refund(key);
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "anthropic",
          module: "quote-request",
          operation: "photo-read",
          httpStatus: error?.status,
          providerError: error?.error?.error?.type,
          details: { model: QUOTE_PHOTO_READ_MODEL },
        },
        error,
      );
      throw new BadGatewayException(QUOTE_PHOTO_READ_ERROR_MESSAGES.FAILED);
    }

    // 비용을 볼 수 있게 사용량만 남긴다(사진·읽은 내용·접속 주소는 남기지 않음)
    LoggerUtil.log(
      `사진 읽기: model=${generation.model} stop=${generation.stopReason} in=${generation.usage.inputTokens} out=${generation.usage.outputTokens} ms=${Date.now() - startedAt} readable=${generation.result !== null} by=${who.consumerId ? "consumer" : "ip"}`,
    );
    return generation.result ?? { unreadable: true };
  }
}
