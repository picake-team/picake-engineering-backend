import type { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import { randomUUID } from "crypto";

import { BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { describe, expect, it, vi } from "vitest";

import { AUDIENCE, AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { KakaoRegisterRequestDto } from "@apps/backend/modules/auth/dto/auth-kakao-oauth.dto";
import { AuthKakaoOauthService } from "@apps/backend/modules/auth/services/auth-kakao-oauth.service";
import type { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import type { RegisterTicketPayload } from "@apps/backend/modules/auth/types/auth.types";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import type { TermsService } from "@apps/backend/modules/terms/terms.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";

/**
 * 카카오 한 번에 가입(기획 I-59 B, 2026-11-16) — 실제 DB로.
 * 카카오가 준 전화번호·약관 동의는 로그인 때 서버가 가입표에 담고, 가입은 가입표에서만 꺼내 쓴다.
 */
const SECRET = "kakao-integration-secret";
const issuer = new JwtUtil(new JwtService({ secret: SECRET }), {} as any);

const CONSUMER_TAGS = ["picake_c_tos", "picake_c_privacy", "picake_c_third_party"];
const SELLER_TAGS = ["picake_s_tos", "picake_s_privacy"];

function buildService() {
  const prisma = getTestPrisma();
  const jwtUtil = new JwtUtil(new JwtService({ secret: SECRET }), {} as any);
  vi.spyOn(jwtUtil, "generateTokenPair").mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
  });
  const authPhoneService = {
    // 문자 인증은 한 번도 안 했다고 둔다 — 카카오 번호로 가입하면 이걸 묻지 않아야 한다
    checkPhoneVerificationStatus: vi.fn().mockResolvedValue(false),
  };
  const termsService = {
    recordConsumerAgreementsInTransaction: vi.fn().mockResolvedValue(undefined),
    recordSellerAgreementsInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthKakaoOauthService(
    prisma,
    jwtUtil,
    { get: () => "x" } as any,
    authPhoneService as unknown as AuthPhoneService,
    termsService as unknown as TermsService,
    { notifyNewSeller: vi.fn().mockResolvedValue(undefined) } as unknown as OpsAlertService,
  );
  return { service, authPhoneService, termsService };
}

async function ticket(over: Partial<RegisterTicketPayload> = {}) {
  return await issuer.generateRegisterTicket({
    aud: AUDIENCE.CONSUMER,
    provider: "kakao",
    providerId: `kakao-${randomUUID()}`,
    email: "kakao@example.com",
    ...over,
  });
}

async function activeTerms(types: string[]) {
  const prisma = getTestPrisma();
  const ids: string[] = [];
  for (const type of types) {
    const doc = await prisma.termsDocument.create({
      data: {
        type: type as any,
        version: `it-${randomUUID().slice(0, 8)}`,
        title: type,
        content: "<p>테스트</p>",
        isActive: true,
        effectiveAt: new Date(Date.now() - 86_400_000),
      },
    });
    ids.push(doc.id);
  }
  return ids;
}

describe("카카오 한 번에 가입 (integration)", () => {
  it("손님이 카카오 번호를 '맞아요'로 확인하고 카카오에서 약관에 동의했으면, 문자 인증·약관 체크 없이 가입하고 활성 약관 버전을 기록한다", async () => {
    const prisma = getTestPrisma();
    const docIds = await activeTerms([
      "CONSUMER_TERMS_OF_SERVICE",
      "CONSUMER_PRIVACY_POLICY",
      "CONSUMER_THIRD_PARTY_CONSENT",
    ]);
    const kakaoId = `kakao-${randomUUID()}`;
    const { service, authPhoneService, termsService } = buildService();

    await service.consumerKakaoRegisterWithPhone({
      registerToken: await ticket({
        providerId: kakaoId,
        phone: "01033334444",
        terms: CONSUMER_TAGS,
      }),
      useTicketPhone: true,
      phone: "01099999999", // 화면이 다른 번호를 끼워 넣어도 카카오 번호로 저장
      name: "카카오손님",
    } as KakaoRegisterRequestDto);

    const saved = await prisma.consumer.findUnique({ where: { kakaoId } });
    expect(saved?.phone).toBe("01033334444");
    expect(saved?.isPhoneVerified).toBe(true);
    expect(authPhoneService.checkPhoneVerificationStatus).not.toHaveBeenCalled();
    const recorded = termsService.recordConsumerAgreementsInTransaction.mock
      .calls[0][2] as string[];
    expect(recorded.sort()).toEqual(docIds.sort());
  });

  it("가입표에 카카오 번호가 없는데 '맞아요'로 보내면 가입하지 않는다", async () => {
    const prisma = getTestPrisma();
    const kakaoId = `kakao-${randomUUID()}`;
    const { service } = buildService();

    await expect(
      service.consumerKakaoRegisterWithPhone({
        registerToken: await ticket({ providerId: kakaoId, terms: CONSUMER_TAGS }),
        useTicketPhone: true,
        name: "번호없음",
      } as KakaoRegisterRequestDto),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED);
    expect(await prisma.consumer.count({ where: { kakaoId } })).toBe(0);
  });

  it("'다른 번호'를 고르면 지금처럼 그 번호의 문자 인증이 있어야 한다", async () => {
    const prisma = getTestPrisma();
    const kakaoId = `kakao-${randomUUID()}`;
    const { service, authPhoneService } = buildService();

    await expect(
      service.consumerKakaoRegisterWithPhone({
        registerToken: await ticket({
          providerId: kakaoId,
          phone: "01033334444",
          terms: CONSUMER_TAGS,
        }),
        phone: "01055556666",
        name: "다른번호",
      } as KakaoRegisterRequestDto),
    ).rejects.toThrow(BadRequestException);
    expect(authPhoneService.checkPhoneVerificationStatus).toHaveBeenCalledWith(
      "01055556666",
      AUDIENCE.CONSUMER,
      expect.anything(),
    );
    expect(await prisma.consumer.count({ where: { kakaoId } })).toBe(0);
  });

  it("카카오 약관 동의가 모자라면(필수 하나 빠짐) 화면 약관 체크가 있어야 한다", async () => {
    const prisma = getTestPrisma();
    const kakaoId = `kakao-${randomUUID()}`;
    const { service } = buildService();

    await expect(
      service.consumerKakaoRegisterWithPhone({
        registerToken: await ticket({
          providerId: kakaoId,
          phone: "01033334444",
          terms: ["picake_c_tos", "picake_c_privacy"],
        }),
        useTicketPhone: true,
        name: "약관모자람",
      } as KakaoRegisterRequestDto),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
    expect(await prisma.consumer.count({ where: { kakaoId } })).toBe(0);
  });

  it("손님 가입표에 사장님 약관 태그가 있어도 손님 약관으로 치지 않는다", async () => {
    const kakaoId = `kakao-${randomUUID()}`;
    const { service } = buildService();

    await expect(
      service.consumerKakaoRegisterWithPhone({
        registerToken: await ticket({
          providerId: kakaoId,
          phone: "01033334444",
          terms: SELLER_TAGS,
        }),
        useTicketPhone: true,
        name: "섞임",
      } as KakaoRegisterRequestDto),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
  });

  it("사장님도 카카오 번호·사장님 약관으로 한 번에 가입한다", async () => {
    const prisma = getTestPrisma();
    const docIds = await activeTerms(["SELLER_TERMS_OF_SERVICE", "SELLER_PRIVACY_POLICY"]);
    const kakaoId = `kakao-${randomUUID()}`;
    const { service, authPhoneService, termsService } = buildService();

    await service.sellerKakaoRegisterWithPhone({
      registerToken: await ticket({
        aud: AUDIENCE.SELLER,
        providerId: kakaoId,
        phone: "01077778888",
        terms: SELLER_TAGS,
      }),
      useTicketPhone: true,
      name: "카카오사장",
    } as KakaoRegisterRequestDto);

    const saved = await prisma.seller.findUnique({ where: { kakaoId } });
    expect(saved?.phone).toBe("01077778888");
    expect(authPhoneService.checkPhoneVerificationStatus).not.toHaveBeenCalled();
    const recorded = termsService.recordSellerAgreementsInTransaction.mock.calls[0][2] as string[];
    expect(recorded.sort()).toEqual(docIds.sort());
  });
});
