import { createHash } from "crypto";

import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthSellerReviewLoginService } from "@apps/backend/modules/auth/services/auth-seller-review-login.service";
import type { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import type { TermsService } from "@apps/backend/modules/terms/terms.service";

/** 테스트에서만 쓰는 코드(실제 심사용 코드는 레포에 두지 않는다) */
const TEST_CODE = "123456";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function buildService(envValue: string | undefined) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaService;
  const jwtUtil = { generateTokenPair: vi.fn() } as unknown as JwtUtil;
  const configService = { get: vi.fn().mockReturnValue(envValue) } as any;
  const termsService = {} as TermsService;
  return {
    service: new AuthSellerReviewLoginService(prisma, jwtUtil, configService, termsService),
    prisma,
  };
}

describe("AuthSellerReviewLoginService 코드 확인", () => {
  it("서버에 코드가 없으면(환경값 없음) 항상 코드 오류이고 DB를 건드리지 않는다", async () => {
    const { service, prisma } = buildService(undefined);
    await expect(service.sellerReviewLogin({ code: TEST_CODE })).rejects.toThrow(
      new UnauthorizedException(AUTH_ERROR_MESSAGES.REVIEW_LOGIN_INVALID_CODE),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("환경값이 SHA-256 형식이 아니면(코드를 그대로 넣은 경우 등) 코드 오류", async () => {
    const { service, prisma } = buildService(TEST_CODE);
    await expect(service.sellerReviewLogin({ code: TEST_CODE })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("코드가 다르면 코드 오류", async () => {
    const { service, prisma } = buildService(sha256(TEST_CODE));
    await expect(service.sellerReviewLogin({ code: "654321" })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("코드가 맞으면(대문자·앞뒤 공백이 있는 환경값도) 심사용 계정 준비로 넘어간다", async () => {
    const { service, prisma } = buildService(`  ${sha256(TEST_CODE).toUpperCase()}\n`);
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("stop-after-code-check"));
    await expect(service.sellerReviewLogin({ code: TEST_CODE })).rejects.toThrow(
      "stop-after-code-check",
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
