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
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
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

/**
 * 상품 상세설명 AI 초안 서비스 (Claude)
 *
 * - 판매자가 준 자료(네이버 설명·확인한 사실·옵션 요약)에 있는 내용만 쓴다. 재료·알레르기·크기·보관처럼
 *   중요한 정보가 없으면 지어내지 않고 [판매자 확인 필요]로 남긴다.
 * - 초안은 저장하지 않는다. 판매자가 고치고 확인한 뒤 상품 등록·수정으로 저장한다.
 * - 판매자당 하루 사용 횟수를 제한한다.
 */
@Injectable()
export class ProductAiDraftService {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly dailyUsage = new Map<string, number>();

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

  /** 판매자당 하루(한국 시간) 사용 횟수 제한 */
  private consumeDailyQuota(sellerId: string): void {
    const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const key = `${sellerId}:${day}`;
    const used = this.dailyUsage.get(key) ?? 0;
    if (used >= PRODUCT_AI_DRAFT_LIMITS.DAILY_PER_SELLER) {
      throw new HttpException(
        PRODUCT_AI_DRAFT_ERROR_MESSAGES.DAILY_LIMIT,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // 지난 날짜 기록은 지운다
    for (const k of this.dailyUsage.keys()) {
      if (!k.endsWith(`:${day}`)) this.dailyUsage.delete(k);
    }
    this.dailyUsage.set(key, used + 1);
  }
}
