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
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { StoreOwnershipUtil } from "@apps/backend/modules/store/utils/store-ownership.util";
import { DailyQuota } from "@apps/backend/common/utils/daily-quota.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import {
  PRODUCT_AI_DRAFT_ERROR_MESSAGES,
  PRODUCT_AI_DRAFT_LIMITS,
  PRODUCT_AI_DRAFT_MODEL,
} from "@apps/backend/modules/product-naver/constants/product-naver.constants";
import {
  ProductDescriptionDraftRequestDto,
  ProductDescriptionDraftResponseDto,
} from "@apps/backend/modules/product-naver/dto/product-naver.dto";
import { generateDescriptionDraft } from "@apps/backend/modules/product-naver/utils/product-ai-draft.generator";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";

/** 오늘 전체 한도에 닿았다고 Sentry에 알리는 간격(계속 막혀도 몇 번만) */
const DAILY_TOTAL_NOTICE_INTERVAL_MS = 6 * 3_600_000;

/**
 * 상품 상세설명 AI 초안 서비스 (Claude)
 *
 * - 판매자가 준 자료(네이버 설명·확인한 사실·옵션 요약)에 있는 내용만 쓴다. 재료·알레르기·크기·보관처럼
 *   중요한 정보가 없으면 지어내지 않고 [판매자 확인 필요]로 남긴다.
 * - 초안은 저장하지 않는다. 판매자가 고치고 확인한 뒤 상품 등록·수정으로 저장한다.
 * - 판매자당 하루 30번, 모든 판매자를 합쳐 하루 300번(넘으면 503). 우리 쪽(연결·Claude) 문제로 못 만들면 두 한도 모두 되돌린다.
 */
@Injectable()
export class ProductAiDraftService {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly quota = new DailyQuota(PRODUCT_AI_DRAFT_LIMITS.DAILY_PER_SELLER);
  private readonly totalQuota = new DailyQuota(PRODUCT_AI_DRAFT_LIMITS.DAILY_TOTAL);

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const apiKey = configService.get<string>("ANTHROPIC_API_KEY");
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }) : null;
    this.model = configService.get<string>("ANTHROPIC_DRAFT_MODEL") || PRODUCT_AI_DRAFT_MODEL;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async createDraftForSeller(
    storeId: string,
    request: ProductDescriptionDraftRequestDto,
    user: JwtVerifiedPayload,
  ): Promise<ProductDescriptionDraftResponseDto> {
    await StoreOwnershipUtil.verifyStoreOwnership(this.prisma, storeId, user.sub);
    if (!this.client) {
      throw new ServiceUnavailableException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.NOT_CONFIGURED);
    }
    if (!request.sourceText?.trim() && !request.sellerFacts?.trim()) {
      throw new BadRequestException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.NO_SOURCE);
    }
    this.consumeDailyQuota(user.sub);

    let result;
    try {
      result = await generateDescriptionDraft(this.client, this.model, request);
    } catch (error: any) {
      // 우리 쪽 문제로 못 만들었으면 두 한도 모두 되돌린다(사진 읽기와 같음)
      this.quota.refund(user.sub);
      this.totalQuota.refund("all");
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "anthropic",
          module: "product-naver",
          operation: "description-draft",
          httpStatus: error?.status,
          providerError: error?.error?.error?.type,
          details: { storeId, model: this.model },
        },
        error,
      );
      throw new BadGatewayException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.FAILED);
    }

    // 사용량을 남겨 비용을 볼 수 있게 한다 (글 내용은 남기지 않음)
    LoggerUtil.log(
      `AI 초안: model=${result.model} stop=${result.stopReason} in=${result.usage.inputTokens} out=${result.usage.outputTokens} storeId=${storeId}`,
    );
    if (!result.draft) throw new BadGatewayException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.FAILED);

    return { ...result.draft, model: result.model };
  }

  /** 판매자당·전체 하루(한국 시간) 사용 횟수 제한 */
  private consumeDailyQuota(sellerId: string): void {
    if (!this.quota.tryConsume(sellerId)) {
      throw new HttpException(
        PRODUCT_AI_DRAFT_ERROR_MESSAGES.DAILY_LIMIT,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.totalQuota.tryConsume("all")) {
      // 이 판매자 몫은 쓰지 않았으니 되돌린다
      this.quota.refund(sellerId);
      SentryUtil.captureExceptionThrottled(
        "product-ai-draft:daily-total",
        DAILY_TOTAL_NOTICE_INTERVAL_MS,
        new Error(`상품 AI 초안 오늘 전체 한도(${PRODUCT_AI_DRAFT_LIMITS.DAILY_TOTAL}번)에 닿음`),
        "warning",
        { module: "product-naver", operation: "description-draft" },
      );
      LoggerUtil.log(`AI 초안: 오늘 전체 한도(${PRODUCT_AI_DRAFT_LIMITS.DAILY_TOTAL}번)에 닿음`);
      throw new ServiceUnavailableException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.UNAVAILABLE_TODAY);
    }
  }
}
