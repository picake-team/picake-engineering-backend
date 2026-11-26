import type { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import { randomUUID } from "crypto";

import { BadRequestException, ConflictException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { describe, expect, it, vi } from "vitest";

import { SellerAppleRegisterRequestDto } from "@apps/backend/modules/auth/dto/auth-apple-oauth.dto";
import { AuthAppleOauthService } from "@apps/backend/modules/auth/services/auth-apple-oauth.service";
import type { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import type { TermsService } from "@apps/backend/modules/terms/terms.service";
import type { TokenEncryptionUtil } from "@apps/backend/common/utils/token-encryption.util";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import { createTestConsumer, createTestSeller } from "@apps/backend/test/integration/factories";

/**
 * 판매자 애플 가입(2026-11-26, 판매자 앱 심사 4.8)을 실제 테스트 DB로 — 새 Seller.appleId @unique 칸과
 * 손님 appleId와의 관계(같은 애플이면 손님·사장님 둘 다 가입 가능)를 본다. 애플 토큰 교환은 부르지 않는다(가입표로만 가입).
 */
const TEST_SECRET = "integration-test-secret";
const issuer = new JwtUtil(new JwtService({ secret: TEST_SECRET }), {} as any);

async function sellerTicket(appleId: string, email = "s@privaterelay.appleid.com") {
  return await issuer.generateRegisterTicket({
    aud: AUDIENCE.SELLER,
    provider: "apple",
    providerId: appleId,
    email,
  });
}

function buildService() {
  const prisma = getTestPrisma();
  const jwtUtil = new JwtUtil(new JwtService({ secret: TEST_SECRET }), {} as any);
  vi.spyOn(jwtUtil, "generateTokenPair").mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
  });
  const authPhoneService = {
    checkPhoneVerificationStatus: vi.fn().mockResolvedValue(true),
  } as unknown as AuthPhoneService;
  const termsService = {
    recordSellerAgreementsInTransaction: vi.fn().mockResolvedValue(undefined),
  } as unknown as TermsService;
  const values: Record<string, string> = {
    APPLE_TEAM_ID: "team-id",
    APPLE_KEY_ID: "key-id",
    APPLE_PRIVATE_KEY: "fake-private-key",
    APPLE_CLIENT_ID: "apple-client-id",
    NODE_ENV: "test",
    PUBLIC_SELLER_DOMAIN: "http://localhost:3002",
  };
  const configService = { get: (k: string) => values[k] } as any;
  return new AuthAppleOauthService(
    prisma,
    jwtUtil,
    configService,
    authPhoneService,
    termsService,
    { encrypt: (v: string) => v, decrypt: (v: string) => v } as unknown as TokenEncryptionUtil,
    { notifyNewSeller: vi.fn().mockResolvedValue(undefined) } as unknown as OpsAlertService,
  );
}

async function buildDto(
  overrides: Partial<SellerAppleRegisterRequestDto> = {},
): Promise<{ dto: SellerAppleRegisterRequestDto; appleId: string }> {
  const appleId = `apple-${randomUUID()}`;
  const dto = {
    registerToken: await sellerTicket(appleId),
    name: "애플사장",
    phone: "01077778888",
    agreedToTerms: true,
    agreedToPrivacy: true,
    agreedToAge14: true,
    ...overrides,
  } as SellerAppleRegisterRequestDto;
  return { dto, appleId };
}

describe("AuthAppleOauthService.sellerAppleRegisterWithPhone (integration)", () => {
  it("가입하면 Seller에 가입표의 appleId·이메일과 번호·만 14세 확인 시각이 저장된다", async () => {
    const prisma = getTestPrisma();
    const { dto, appleId } = await buildDto();

    await buildService().sellerAppleRegisterWithPhone(dto);

    const row = await prisma.seller.findUnique({ where: { appleId } });
    expect(row).toMatchObject({
      appleId,
      appleEmail: "s@privaterelay.appleid.com",
      phone: "01077778888",
      name: "애플사장",
      isPhoneVerified: true,
      appleRefreshToken: null,
    });
    expect(row?.ageConfirmedAt).toBeInstanceOf(Date);
  });

  it("같은 애플로 가입한 손님이 있어도 사장님 가입은 된다(역할마다 계정이 따로)", async () => {
    const prisma = getTestPrisma();
    const { dto, appleId } = await buildDto();
    await createTestConsumer(prisma, { appleId, appleEmail: "s@privaterelay.appleid.com" });

    await buildService().sellerAppleRegisterWithPhone(dto);

    expect(await prisma.seller.count({ where: { appleId } })).toBe(1);
    expect(await prisma.consumer.count({ where: { appleId } })).toBe(1);
  });

  it("이미 그 애플로 가입한 사장님이 있으면 409", async () => {
    const prisma = getTestPrisma();
    const { dto, appleId } = await buildDto();
    await createTestSeller(prisma, { appleId });

    await expect(buildService().sellerAppleRegisterWithPhone(dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it("손님용 가입표로는 사장님 가입이 안 된다(대상 확인)", async () => {
    const appleId = `apple-${randomUUID()}`;
    const consumerTicket = await issuer.generateRegisterTicket({
      aud: AUDIENCE.CONSUMER,
      provider: "apple",
      providerId: appleId,
      email: "c@privaterelay.appleid.com",
    });
    const { dto } = await buildDto({ registerToken: consumerTicket });

    await expect(buildService().sellerAppleRegisterWithPhone(dto)).rejects.toThrow(
      BadRequestException,
    );
  });
});
