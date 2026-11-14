import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BadGatewayException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

// Claude는 부르지 않는다: 초안 만들기를 가짜로 바꾼다
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@apps/backend/modules/product-naver/utils/product-ai-draft.generator", () => ({
  generateDescriptionDraft: generate,
}));

import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import type { PrismaService } from "@apps/backend/infra/database/prisma.service";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { StoreOwnershipUtil } from "@apps/backend/modules/store/utils/store-ownership.util";
import { PRODUCT_AI_DRAFT_ERROR_MESSAGES } from "@apps/backend/modules/product-naver/constants/product-naver.constants";
import { ProductAiDraftService } from "@apps/backend/modules/product-naver/services/product-ai-draft.service";

const OK = {
  draft: { paragraphs: ["딸기가 올라간 생크림 케이크예요."], questions: [] },
  model: "claude-haiku-5-5",
  stopReason: "end_turn",
  usage: { inputTokens: 900, outputTokens: 300 },
};
const REQUEST = { productName: "딸기 케이크", sourceText: "딸기 생크림 케이크" };
const seller = (id: string) => ({ sub: id }) as unknown as JwtVerifiedPayload;

function build() {
  const config = { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test-key" : undefined) };
  return new ProductAiDraftService({} as PrismaService, config as unknown as ConfigService);
}

describe("ProductAiDraftService 하루 한도(상품 상세설명 AI 초안)", () => {
  beforeEach(() => {
    generate.mockReset();
    generate.mockResolvedValue(OK);
    vi.spyOn(StoreOwnershipUtil, "verifyStoreOwnership").mockResolvedValue(undefined as never);
    vi.spyOn(LoggerUtil, "log").mockImplementation(() => undefined);
    vi.spyOn(ExternalApiErrorUtil, "reportFailure").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("판매자마다 하루 30번, 31번째는 429", async () => {
    const service = build();
    for (let i = 0; i < 30; i += 1) await service.createDraftForSeller("s1", REQUEST, seller("a"));
    await expect(service.createDraftForSeller("s1", REQUEST, seller("a"))).rejects.toMatchObject({
      status: 429,
    });
    // 다른 판매자는 쓸 수 있다
    await expect(service.createDraftForSeller("s2", REQUEST, seller("b"))).resolves.toHaveProperty(
      "paragraphs",
    );
  });

  it("모든 판매자를 합쳐 하루 300번: 넘으면 503, 그 판매자 몫은 세지 않고 Sentry에 알린다", async () => {
    const sentry = vi.spyOn(SentryUtil, "captureExceptionThrottled").mockReturnValue(true);
    const service = build();
    for (let n = 0; n < 10; n += 1) {
      for (let i = 0; i < 30; i += 1) {
        await service.createDraftForSeller("s", REQUEST, seller(`seller-${n}`));
      }
    }
    expect(generate).toHaveBeenCalledTimes(300);
    expect(sentry).not.toHaveBeenCalled();

    // 오늘 아직 안 쓴 판매자도 막힌다. 몫을 되돌려 35번 불러도 429가 아니라 503
    for (let i = 0; i < 35; i += 1) {
      await expect(service.createDraftForSeller("s", REQUEST, seller("late"))).rejects.toThrow(
        new ServiceUnavailableException(PRODUCT_AI_DRAFT_ERROR_MESSAGES.UNAVAILABLE_TODAY),
      );
    }
    expect(generate).toHaveBeenCalledTimes(300);
    expect(sentry).toHaveBeenCalledWith(
      "product-ai-draft:daily-total",
      expect.any(Number),
      expect.any(Error),
      "warning",
      expect.objectContaining({ operation: "description-draft" }),
    );

    // 한국 시간 자정이 지나면 다시 쓴다
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 3_600_000);
    await expect(
      service.createDraftForSeller("s", REQUEST, seller("late")),
    ).resolves.toHaveProperty("paragraphs");
  });

  it("Claude 쪽 실패는 두 한도 모두에서 세지 않는다", async () => {
    const service = build();
    for (let i = 0; i < 5; i += 1) {
      generate.mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 529 }));
    }
    for (let i = 0; i < 5; i += 1) {
      await expect(service.createDraftForSeller("s1", REQUEST, seller("a"))).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    }
    // 실패 5번은 세지 않았으니 30번을 다 쓴다
    for (let i = 0; i < 30; i += 1) await service.createDraftForSeller("s1", REQUEST, seller("a"));
    await expect(service.createDraftForSeller("s1", REQUEST, seller("a"))).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(generate).toHaveBeenCalledTimes(35);
  });
});
