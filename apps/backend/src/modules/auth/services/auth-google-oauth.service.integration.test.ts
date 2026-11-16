import type { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import { randomUUID } from "crypto";

import { BadRequestException, ConflictException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { describe, expect, it, vi } from "vitest";

import { GoogleRegisterRequestDto } from "@apps/backend/modules/auth/dto/auth-google-oauth.dto";
import { AuthGoogleOauthService } from "@apps/backend/modules/auth/services/auth-google-oauth.service";
import type { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import type { TermsService } from "@apps/backend/modules/terms/terms.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import { createTestConsumer } from "@apps/backend/test/integration/factories";

/**
 * 유닛테스트(auth-google-oauth.service.spec.ts)는 Prisma를 전부 mock 처리해서
 * "googleId가 이미 있으면 어떤 예외를 던지는가" 같은 순수 로직만 검증합니다.
 * 여기서는 실제 Postgres에 붙여서, Consumer.googleId/phone에 걸린 @unique 제약이
 * 애플리케이션 로직의 허점(조회 후 생성 사이의 race)까지 실제로 막아주는지를 검증합니다.
 */
const TEST_SECRET = "integration-test-secret";

describe("AuthGoogleOauthService.consumerGoogleRegisterWithPhone (integration)", () => {
  function buildService() {
    const prisma = getTestPrisma();
    // 가입표 확인은 실제 서명·검증으로, 토큰 발급만 가짜로
    const jwtUtil = new JwtUtil(new JwtService({ secret: TEST_SECRET }), {} as any);
    vi.spyOn(jwtUtil, "generateTokenPair").mockResolvedValue({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    const authPhoneService = {
      checkPhoneVerificationStatus: vi.fn().mockResolvedValue(true),
    } as unknown as AuthPhoneService;
    const termsService = {
      recordConsumerAgreementsInTransaction: vi.fn().mockResolvedValue(undefined),
    } as unknown as TermsService;
    const configService = { get: () => undefined } as any;

    return new AuthGoogleOauthService(
      prisma,
      jwtUtil,
      configService,
      authPhoneService,
      termsService,
      { notifyNewSeller: vi.fn().mockResolvedValue(undefined) } as unknown as OpsAlertService,
    );
  }

  function buildDto(overrides: Partial<GoogleRegisterRequestDto> = {}): GoogleRegisterRequestDto {
    return {
      googleId: `google-${randomUUID()}`,
      googleEmail: "test@example.com",
      name: "테스트유저",
      phone: "01012345678",
      agreedToTerms: true,
      agreedToPrivacy: true,
      agreedToThirdParty: true,
      ...overrides,
    } as GoogleRegisterRequestDto;
  }

  it("가입에 성공하면 실제 DB에 googleId/phone이 저장된다", async () => {
    const prisma = getTestPrisma();
    const service = buildService();
    const dto = buildDto();

    await service.consumerGoogleRegisterWithPhone(dto);

    const saved = await prisma.consumer.findUnique({ where: { googleId: dto.googleId } });
    expect(saved).not.toBeNull();
    expect(saved?.phone).toBe(dto.phone);
    expect(saved?.isPhoneVerified).toBe(true);
  });

  it("같은 googleId로 동시에 두 번 가입 요청이 들어와도 DB에는 한 건만 남는다", async () => {
    const prisma = getTestPrisma();
    const service = buildService();
    const dto = buildDto();

    // 코드상 googleId 중복 검사(findUnique)와 실제 생성(create) 사이에 원자적 보호가 없고,
    // OrderCreateService처럼 P2002를 잡아 재시도하지도 않는다. 그래도 DB의 @unique 제약이
    // 최후의 방어선으로 실제 동시 요청에서도 중복 가입을 막아주는지를 검증한다.
    const settled = await Promise.allSettled([
      service.consumerGoogleRegisterWithPhone(dto),
      service.consumerGoogleRegisterWithPhone({ ...dto, phone: "01099998888" }),
    ]);

    const consumers = await prisma.consumer.findMany({ where: { googleId: dto.googleId } });
    expect(consumers).toHaveLength(1);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("이미 카카오로 가입된 번호면 같은 번호로 구글 가입을 시도해도 거부된다", async () => {
    const prisma = getTestPrisma();
    const existing = await createTestConsumer(prisma, {
      phone: "01055556666",
      kakaoId: "kakao-existing-user",
    });
    const service = buildService();

    await expect(
      service.consumerGoogleRegisterWithPhone(buildDto({ phone: existing.phone })),
    ).rejects.toThrow(ConflictException);

    expect(await prisma.consumer.count({ where: { phone: existing.phone } })).toBe(1);
  });

  // 계정 보강 ②(2026-11-16): 가입은 로그인 때 서버가 확인한 ID(가입표)로만 — 화면이 보낸 ID를 믿지 않는다
  it("가입표가 있으면 화면이 함께 보낸 googleId가 아니라 가입표 안의 googleId·이메일로 저장한다", async () => {
    const prisma = getTestPrisma();
    const jwtUtil = new JwtUtil(new JwtService({ secret: TEST_SECRET }), {} as any);
    const realGoogleId = `google-${randomUUID()}`;
    const registerToken = await jwtUtil.generateRegisterTicket({
      aud: AUDIENCE.CONSUMER,
      provider: "google",
      providerId: realGoogleId,
      email: "real@gmail.com",
    });
    const forgedGoogleId = `google-${randomUUID()}`;

    await buildService().consumerGoogleRegisterWithPhone(
      buildDto({ registerToken, googleId: forgedGoogleId, googleEmail: "forged@gmail.com" }),
    );

    const saved = await prisma.consumer.findUnique({ where: { googleId: realGoogleId } });
    expect(saved?.googleEmail).toBe("real@gmail.com");
    expect(await prisma.consumer.count({ where: { googleId: forgedGoogleId } })).toBe(0);
  });

  it("다른 열쇠로 서명한 가짜 가입표면 가입하지 않는다", async () => {
    const prisma = getTestPrisma();
    const forger = new JwtUtil(new JwtService({ secret: "attacker-secret" }), {} as any);
    const googleId = `google-${randomUUID()}`;
    const registerToken = await forger.generateRegisterTicket({
      aud: AUDIENCE.CONSUMER,
      provider: "google",
      providerId: googleId,
      email: "victim@gmail.com",
    });

    await expect(
      buildService().consumerGoogleRegisterWithPhone(buildDto({ registerToken, googleId })),
    ).rejects.toThrow(BadRequestException);
    expect(await prisma.consumer.count({ where: { googleId } })).toBe(0);
  });

  it("사장님용 가입표로는 손님 가입을 할 수 없다", async () => {
    const prisma = getTestPrisma();
    const jwtUtil = new JwtUtil(new JwtService({ secret: TEST_SECRET }), {} as any);
    const googleId = `google-${randomUUID()}`;
    const registerToken = await jwtUtil.generateRegisterTicket({
      aud: AUDIENCE.SELLER,
      provider: "google",
      providerId: googleId,
      email: "seller@gmail.com",
    });

    await expect(
      buildService().consumerGoogleRegisterWithPhone(buildDto({ registerToken })),
    ).rejects.toThrow(BadRequestException);
    expect(await prisma.consumer.count({ where: { googleId } })).toBe(0);
  });
});
