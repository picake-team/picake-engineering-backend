import Anthropic from "@anthropic-ai/sdk";
import { PRODUCT_AI_DRAFT_LIMITS } from "@apps/backend/modules/product-naver/constants/product-naver.constants";
import type { ProductDescriptionDraftRequestDto } from "@apps/backend/modules/product-naver/dto/product-naver.dto";
import {
  buildDescriptionDraftPrompt,
  DESCRIPTION_DRAFT_OUTPUT_SCHEMA,
  DESCRIPTION_DRAFT_SYSTEM_PROMPT,
  parseDescriptionDraft,
} from "@apps/backend/modules/product-naver/utils/product-ai-draft.util";

export type DescriptionDraftGeneration = {
  draft: { paragraphs: string[]; questions: string[] } | null;
  model: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * 짧은 문안 작성이라 생각(thinking)은 끈다 (토큰 절약).
 * Haiku 5.5는 effort low에서 disabled를 받고, Sonnet 5.5는 disabled 대신 between_tools로 끈다.
 */
export function thinkingFor(model: string): Anthropic.ThinkingConfigParam | undefined {
  if (model.startsWith("claude-haiku-5")) return { type: "disabled" };
  if (model.startsWith("claude-sonnet-5-5")) return { type: "between_tools" };
  return undefined;
}

/**
 * 상품 상세설명 초안을 한 번 만든다. 서비스와 점검 스크립트가 같이 쓴다.
 * - effort low, 생각 끔, 출력 상한, JSON 형식 고정으로 토큰을 아낀다
 * - 저장하지 않는다
 */
export async function generateDescriptionDraft(
  client: Anthropic,
  model: string,
  request: ProductDescriptionDraftRequestDto,
): Promise<DescriptionDraftGeneration> {
  const thinking = thinkingFor(model);
  const response = await client.messages.create({
    model,
    max_tokens: PRODUCT_AI_DRAFT_LIMITS.MAX_OUTPUT_TOKENS,
    system: DESCRIPTION_DRAFT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildDescriptionDraftPrompt(request) }],
    ...(thinking ? { thinking } : {}),
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: DESCRIPTION_DRAFT_OUTPUT_SCHEMA },
    },
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const draft =
    response.stop_reason === "refusal" || response.stop_reason === "max_tokens"
      ? null
      : parseDescriptionDraft(text);

  return {
    draft,
    model: response.model ?? model,
    stopReason: response.stop_reason ?? null,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}
