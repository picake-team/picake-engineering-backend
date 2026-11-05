import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  generateDescriptionDraft,
  thinkingFor,
} from "@apps/backend/modules/product-naver/utils/product-ai-draft.generator";

function fakeClient(response: Partial<Anthropic.Message>) {
  const create = vi.fn(async () => response);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const okResponse = {
  model: "claude-haiku-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ paragraphs: ["첫 문단"], questions: [] }) }],
  usage: { input_tokens: 700, output_tokens: 250 },
} as unknown as Partial<Anthropic.Message>;

describe("generateDescriptionDraft", () => {
  it("토큰을 아끼는 설정으로 부른다 (effort low, 생각 끔, 출력 상한, JSON 형식)", async () => {
    const { client, create } = fakeClient(okResponse);
    const r = await generateDescriptionDraft(client, "claude-haiku-5-5", {
      productName: "샘플",
      sourceText: "설명",
    });
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.max_tokens).toBeLessThanOrEqual(1500);
    expect(r).toMatchObject({
      draft: { paragraphs: ["첫 문단"], questions: [] },
      usage: { inputTokens: 700, outputTokens: 250 },
    });
  });

  it("출력 상한에 걸려 잘린 응답은 초안으로 쓰지 않는다", async () => {
    const { client } = fakeClient({ ...okResponse, stop_reason: "max_tokens" });
    const r = await generateDescriptionDraft(client, "claude-haiku-5-5", { productName: "샘플" });
    expect(r.draft).toBeNull();
  });

  it("거절한 응답은 초안으로 쓰지 않는다", async () => {
    const { client } = fakeClient({ ...okResponse, stop_reason: "refusal" });
    const r = await generateDescriptionDraft(client, "claude-haiku-5-5", { productName: "샘플" });
    expect(r.draft).toBeNull();
  });
});

describe("thinkingFor", () => {
  it("모델마다 생각을 끄는 방법이 다르다", () => {
    expect(thinkingFor("claude-haiku-5-5")).toEqual({ type: "disabled" });
    expect(thinkingFor("claude-sonnet-5-5")).toEqual({ type: "between_tools" });
    expect(thinkingFor("claude-opus-5-5")).toBeUndefined();
  });
});
