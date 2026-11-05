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
import {
  buildDescriptionDraftPrompt,
  DESCRIPTION_DRAFT_OUTPUT_SCHEMA,
  DESCRIPTION_DRAFT_SYSTEM_PROMPT,
  parseDescriptionDraft,
} from "@apps/backend/modules/product-naver/utils/product-ai-draft.util";

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
  private readonly dailyUsage = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const apiKey = configService.get<string>("ANTHROPIC_API_KEY");
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }) : null;
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

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: PRODUCT_AI_DRAFT_MODEL,
        max_tokens: PRODUCT_AI_DRAFT_LIMITS.MAX_OUTPUT_TOKENS,
        system: DESCRIPTION_DRAFT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildDescriptionDraftPrompt(request) }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: DESCRIPTION_DRAFT_OUTPUT_SCHEMA },
        },
      });
    } catch (error: any) {
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "anthropic",
          module: "product-naver",
          operation: "description-draft",
          httpStatus: error?.status,
          providerError: error?.error?.error?.type,
          details: { storeId },
        },
        error,
      );
      throw new BadGatewayException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.FAILED);
    }

    if (response.stop_reason === "refusal") {
      throw new BadGatewayException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.FAILED);
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    const draft = parseDescriptionDraft(text);
    if (!draft) throw new BadGatewayException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.FAILED);

    return { ...draft, model: PRODUCT_AI_DRAFT_MODEL };
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
