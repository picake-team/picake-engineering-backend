import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { TermsService } from "@apps/backend/modules/terms/terms.service";

import { AuthKakaoOauthService } from "./auth-kakao-oauth.service";

vi.mock("axios", () => ({
  default: { create: vi.fn() },
}));

describe("AuthKakaoOauthService.consumerKakaoLoginWithCode", () => {
  const httpClientMock = { post: vi.fn(), get: vi.fn() };
  const prismaMock = mockDeep<PrismaService>();
  const jwtUtilMock = { generateTokenPair: vi.fn(), generateRegisterTicket: vi.fn() };

  let service: AuthKakaoOauthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue(httpClientMock as any);
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
    jwtUtilMock.generateRegisterTicket.mockResolvedValue("test-register-ticket");
    jwtUtilMock.generateTokenPair.mockResolvedValue({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });

    const configServiceMock: Partial<ConfigService> = {
      get: vi.fn((key: string) => {
        const values: Record<string, string> = {
          KAKAO_CLIENT_ID: "kakao-client-id",
          KAKAO_CLIENT_SECRET: "kakao-client-secret",
          KAKAO_CLIENT_ID_SELLER: "kakao-client-id-seller",
          KAKAO_CLIENT_SECRET_SELLER: "kakao-client-secret-seller",
          PUBLIC_USER_DOMAIN: "https://picakes.com",
          PUBLIC_SELLER_DOMAIN: "https://seller.picakes.com",
        };
        return values[key];
      }) as any,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthKakaoOauthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtUtil, useValue: jwtUtilMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: AuthPhoneService, useValue: {} },
        { provide: TermsService, useValue: {} },
        { provide: OpsAlertService, useValue: { notifyNewSeller: vi.fn() } },
      ],
    }).compile();

    service = moduleRef.get(AuthKakaoOauthService);
  });

  function mockSuccessfulTokenExchange() {
    httpClientMock.post.mockResolvedValue({
      data: { access_token: "kakao-access-token" },
      status: 200,
    });
    httpClientMock.get.mockResolvedValue({
      data: { id: 123456, kakao_account: { email: "user@kakao.com" } },
      status: 200,
    });
  }

  it("가입된 활성 회원이 카카오 토큰 교환에 성공하면 자체 토큰 쌍을 발급한다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: "consumer-1",
      kakaoId: "123456",
      isActive: true,
      phone: "01012345678",
      isPhoneVerified: true,
    } as any);

    const result = await service.consumerKakaoLoginWithCode({ code: "auth-code" });

    expect(result).toEqual({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    expect(prismaMock.consumer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "consumer-1" } }),
    );
  });

  it("카카오 토큰 응답에 access_token이 없으면 토큰 교환 실패 예외를 던진다", async () => {
    httpClientMock.post.mockResolvedValue({ data: {}, status: 200 });

    await expect(service.consumerKakaoLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.KAKAO_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
    expect(httpClientMock.get).not.toHaveBeenCalled();
  });

  it("카카오 사용자 정보에 id 또는 email이 없으면 토큰 교환 실패 예외를 던진다", async () => {
    httpClientMock.post.mockResolvedValue({
      data: { access_token: "kakao-access-token" },
      status: 200,
    });
    httpClientMock.get.mockResolvedValue({ data: { id: 123456 }, status: 200 });

    await expect(service.consumerKakaoLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.KAKAO_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
  });

  it("가입되지 않은 카카오 계정이면 휴대폰 인증(가입) 필요 예외를 던진다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    await expect(service.consumerKakaoLoginWithCode({ code: "auth-code" })).rejects.toMatchObject({
      response: expect.objectContaining({
        message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
        registerToken: "test-register-ticket",
      }),
    });
    // 가입표에는 서버가 카카오에 확인한 값만 담는다(손님용)
    expect(jwtUtilMock.generateRegisterTicket).toHaveBeenCalledWith(
      expect.objectContaining({ aud: "consumer", provider: "kakao" }),
    );
  });

  it("새 손님이면 카카오가 준 전화번호·이름·간편가입 약관 동의를 가입표에 담는다(I-59 B)", async () => {
    httpClientMock.post.mockResolvedValue({
      data: { access_token: "kakao-access-token" },
      status: 200,
    });
    httpClientMock.get.mockImplementation(async (url: string) =>
      url.includes("service_terms")
        ? {
            status: 200,
            data: {
              service_terms: [
                { tag: "picake_c_tos", agreed: true, agreed_at: new Date().toISOString() },
                { tag: "picake_c_privacy", agreed: true, agreed_at: new Date().toISOString() },
                { tag: "picake_c_third_party", agreed: true, agreed_at: new Date().toISOString() },
                { tag: "picake_s_tos", agreed: true, agreed_at: new Date().toISOString() },
              ],
            },
          }
        : {
            status: 200,
            data: {
              id: 123456,
              kakao_account: {
                email: "user@kakao.com",
                phone_number: "+82 10-2222-3333",
                name: "홍길동",
              },
            },
          },
    );
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    await expect(service.consumerKakaoLoginWithCode({ code: "auth-code" })).rejects.toMatchObject({
      response: expect.objectContaining({ registerToken: "test-register-ticket" }),
    });
    expect(jwtUtilMock.generateRegisterTicket).toHaveBeenCalledWith({
      aud: "consumer",
      provider: "kakao",
      providerId: "123456",
      email: "user@kakao.com",
      phone: "01022223333",
      name: "홍길동",
      // 사장님 약관 태그는 빠진다
      terms: ["picake_c_tos", "picake_c_privacy", "picake_c_third_party"],
    });
  });

  it("간편가입 약관 조회가 실패해도 가입표는 나온다(약관은 가입 화면에서)", async () => {
    httpClientMock.post.mockResolvedValue({
      data: { access_token: "kakao-access-token" },
      status: 200,
    });
    httpClientMock.get.mockImplementation(async (url: string) => {
      if (url.includes("service_terms")) throw new Error("KOE");
      return { status: 200, data: { id: 123456, kakao_account: { email: "user@kakao.com" } } };
    });
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    await expect(service.consumerKakaoLoginWithCode({ code: "auth-code" })).rejects.toMatchObject({
      response: expect.objectContaining({ registerToken: "test-register-ticket" }),
    });
    expect(jwtUtilMock.generateRegisterTicket).toHaveBeenCalledWith(
      expect.objectContaining({ terms: [], phone: undefined, name: undefined }),
    );
  });

  it("비활성화된 계정은 로그인이 거부된다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: "consumer-1",
      kakaoId: "123456",
      isActive: false,
      phone: "01012345678",
      isPhoneVerified: true,
    } as any);

    await expect(service.consumerKakaoLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("휴대폰 인증이 안 된 계정은 인증 필요 예외를 던진다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: "consumer-1",
      kakaoId: "123456",
      isActive: true,
      phone: "01012345678",
      isPhoneVerified: false,
    } as any);

    await expect(service.consumerKakaoLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      BadRequestException,
    );
  });
});
