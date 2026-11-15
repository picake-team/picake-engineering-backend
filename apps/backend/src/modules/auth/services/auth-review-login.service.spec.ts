import { createHash } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";

import { AuthReviewLoginService } from "./auth-review-login.service";

/** 손님 심사용 로그인: 코드는 서버 비밀값(코드의 SHA-256)과 비교한다. 비밀값이 없으면 꺼진다 */
describe("AuthReviewLoginService.consumerReviewLogin", () => {
  const sha = (code: string) => createHash("sha256").update(code, "utf8").digest("hex");
  const consumer = { id: "c1", isActive: true };
  let env: Record<string, string | undefined>;
  const prisma = {
    consumer: { upsert: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const jwtUtil = { generateTokenPair: vi.fn() };
  const config = { get: vi.fn((key: string) => env[key]) };
  const service = () =>
    new AuthReviewLoginService(prisma as never, jwtUtil as never, config as never);

  beforeEach(() => {
    vi.clearAllMocks();
    env = { CONSUMER_REVIEW_LOGIN_CODE_SHA256: sha("135790") };
    prisma.consumer.upsert.mockResolvedValue(consumer);
    jwtUtil.generateTokenPair.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  });

  it("비밀값과 같은 코드면 심사용 손님 토큰을 준다", async () => {
    await expect(service().consumerReviewLogin({ code: "135790" })).resolves.toEqual({
      accessToken: "a",
      refreshToken: "r",
    });
  });

  it("예전에 공개 레포에 있던 코드(482915)·다른 코드는 막는다", async () => {
    for (const code of ["482915", "000000", "135791"]) {
      await expect(service().consumerReviewLogin({ code })).rejects.toThrow(
        new UnauthorizedException(AUTH_ERROR_MESSAGES.REVIEW_LOGIN_INVALID_CODE),
      );
    }
    expect(prisma.consumer.upsert).not.toHaveBeenCalled();
  });

  it("비밀값이 없거나 형식이 틀리면 꺼진다(항상 코드 오류)", async () => {
    for (const value of [undefined, "", "not-a-hash"]) {
      env = { CONSUMER_REVIEW_LOGIN_CODE_SHA256: value };
      await expect(service().consumerReviewLogin({ code: "135790" })).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });
});
