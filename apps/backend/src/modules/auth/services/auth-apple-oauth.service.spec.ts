import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import axios from "axios";
import * as jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { TokenEncryptionUtil } from "@apps/backend/common/utils/token-encryption.util";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { TermsService } from "@apps/backend/modules/terms/terms.service";
import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";

import { AuthAppleOauthService } from "./auth-apple-oauth.service";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { ConflictException } from "@nestjs/common";

vi.mock("axios", () => ({
  default: { create: vi.fn() },
}));

vi.mock("jsonwebtoken", () => ({
  sign: vi.fn(() => "fake-client-secret"),
  verify: vi.fn(),
}));

describe("AuthAppleOauthService.consumerAppleLoginWithCode", () => {
  const httpClientMock = { post: vi.fn(), get: vi.fn() };
  const prismaMock = mockDeep<PrismaService>();
  const jwtUtilMock = { generateTokenPair: vi.fn(), generateRegisterTicket: vi.fn() };
  const tokenEncryptionUtilMock = {
    encrypt: vi.fn((plain: string) => `encrypted:${plain}`),
    decrypt: vi.fn((cipher: string) => cipher.replace("encrypted:", "")),
  };

  let service: AuthAppleOauthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue(httpClientMock as any);
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
    jwtUtilMock.generateRegisterTicket.mockResolvedValue("test-register-ticket");
    jwtUtilMock.generateTokenPair.mockResolvedValue({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    tokenEncryptionUtilMock.encrypt.mockImplementation((plain: string) => `encrypted:${plain}`);

    const configServiceMock: Partial<ConfigService> = {
      get: vi.fn((key: string) => {
        const values: Record<string, string> = {
          APPLE_TEAM_ID: "team-id",
          APPLE_KEY_ID: "key-id",
          APPLE_PRIVATE_KEY: "fake-private-key",
          APPLE_CLIENT_ID: "apple-client-id",
          NODE_ENV: "development",
          PUBLIC_SELLER_DOMAIN: "https://seller.example.test",
        };
        return values[key];
      }) as any,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthAppleOauthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtUtil, useValue: jwtUtilMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: AuthPhoneService, useValue: {} },
        { provide: TermsService, useValue: {} },
        { provide: TokenEncryptionUtil, useValue: tokenEncryptionUtilMock },
        { provide: OpsAlertService, useValue: { notifyNewSeller: vi.fn() } },
      ],
    }).compile();

    service = moduleRef.get(AuthAppleOauthService);
  });

  function mockIdTokenVerification(
    payload: { sub?: string; email?: string } | null,
    error?: Error,
  ) {
    vi.mocked(jwt.verify).mockImplementation(
      (_token: any, _keyResolver: any, _opts: any, cb: any) => {
        if (error) {
          cb(error);
          return;
        }
        cb(null, payload);
      },
    );
  }

  function mockSuccessfulTokenExchange() {
    httpClientMock.post.mockResolvedValue({
      data: { id_token: "fake-id-token", refresh_token: "apple-refresh-token" },
      status: 200,
    });
    mockIdTokenVerification({ sub: "apple-user-1", email: "user@privaterelay.appleid.com" });
  }

  it("가입된 활성 회원이 애플 id_token 검증에 성공하면 자체 토큰 쌍을 발급하고 refresh_token을 암호화 저장한다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: "consumer-1",
      appleId: "apple-user-1",
      isActive: true,
      phone: "01012345678",
      isPhoneVerified: true,
    } as any);

    const result = await service.consumerAppleLoginWithCode({ code: "auth-code" });

    expect(result).toEqual({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    expect(tokenEncryptionUtilMock.encrypt).toHaveBeenCalledWith("apple-refresh-token");
    expect(prismaMock.consumer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "consumer-1" },
        data: expect.objectContaining({ appleRefreshToken: "encrypted:apple-refresh-token" }),
      }),
    );
  });

  it("토큰 응답에 id_token 또는 refresh_token이 없으면 토큰 교환 실패 예외를 던진다", async () => {
    httpClientMock.post.mockResolvedValue({ data: {}, status: 200 });

    await expect(service.consumerAppleLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.APPLE_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
  });

  it("id_token 서명 검증에 실패하면 토큰 교환 실패 예외를 던진다", async () => {
    httpClientMock.post.mockResolvedValue({
      data: { id_token: "fake-id-token", refresh_token: "apple-refresh-token" },
      status: 200,
    });
    mockIdTokenVerification(null, new Error("invalid signature"));

    await expect(service.consumerAppleLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.APPLE_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
  });

  it("id_token 검증은 성공했지만 sub 또는 email이 없으면 토큰 교환 실패 예외를 던진다", async () => {
    httpClientMock.post.mockResolvedValue({
      data: { id_token: "fake-id-token", refresh_token: "apple-refresh-token" },
      status: 200,
    });
    mockIdTokenVerification({ sub: "apple-user-1" });

    await expect(service.consumerAppleLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.APPLE_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
  });

  it("가입되지 않은 애플 계정이면 휴대폰 인증(가입) 필요 예외를 던진다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    await expect(service.consumerAppleLoginWithCode({ code: "auth-code" })).rejects.toMatchObject({
      response: expect.objectContaining({
        message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
        registerToken: "test-register-ticket",
      }),
    });
    // 가입표에는 서버가 애플에 확인한 값만 담는다(손님용)
    expect(jwtUtilMock.generateRegisterTicket).toHaveBeenCalledWith(
      expect.objectContaining({ aud: "consumer", provider: "apple" }),
    );
  });

  it("비활성화된 계정은 로그인이 거부된다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: "consumer-1",
      appleId: "apple-user-1",
      isActive: false,
      phone: "01012345678",
      isPhoneVerified: true,
    } as any);

    await expect(service.consumerAppleLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("휴대폰 인증이 안 된 계정은 인증 필요 예외를 던진다", async () => {
    mockSuccessfulTokenExchange();
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: "consumer-1",
      appleId: "apple-user-1",
      isActive: true,
      phone: "01012345678",
      isPhoneVerified: false,
    } as any);

    await expect(service.consumerAppleLoginWithCode({ code: "auth-code" })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe("AuthAppleOauthService.consumerAppleRegisterWithPhone — 번호 중복", () => {
  const prismaMock = mockDeep<PrismaService>();
  let service: AuthAppleOauthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue({ post: vi.fn(), get: vi.fn() } as any);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthAppleOauthService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: JwtUtil,
          useValue: {
            verifyRegisterTicket: vi
              .fn()
              .mockResolvedValue({ providerId: "apple-new", email: "a@privaterelay.appleid.com" }),
            generateTokenPair: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(
              (key: string) =>
                ({
                  APPLE_TEAM_ID: "team-id",
                  APPLE_KEY_ID: "key-id",
                  APPLE_PRIVATE_KEY: "fake-private-key",
                  APPLE_CLIENT_ID: "apple-client-id",
                })[key],
            ),
          },
        },
        {
          provide: AuthPhoneService,
          useValue: { checkPhoneVerificationStatus: vi.fn().mockResolvedValue(true) },
        },
        { provide: TermsService, useValue: {} },
        { provide: TokenEncryptionUtil, useValue: {} },
        { provide: OpsAlertService, useValue: { notifyNewSeller: vi.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthAppleOauthService);
    prismaMock.consumer.findUnique.mockResolvedValue(null);
  });

  const dto = {
    registerToken: "t",
    name: "애플",
    phone: "01055556666",
    agreedToTerms: true,
    agreedToPrivacy: true,
    agreedToThirdParty: true,
  } as any;

  it("소셜 연결이 없는 계정의 번호면 500이 아니라 409(11-16 검토)", async () => {
    prismaMock.consumer.findFirst.mockResolvedValue({
      isActive: true,
      phone: "01055556666",
    } as any);
    await expect(service.consumerAppleRegisterWithPhone(dto)).rejects.toThrow(
      new ConflictException(AUTH_ERROR_MESSAGES.PHONE_ALREADY_EXISTS),
    );
  });

  it("확인 뒤 저장에서 유니크 충돌(동시에 두 번 등)이 나도 500이 아니라 409", async () => {
    prismaMock.consumer.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["apple_id"] },
      }),
    );
    await expect(service.consumerAppleRegisterWithPhone(dto)).rejects.toThrow(
      new ConflictException(AUTH_ERROR_MESSAGES.APPLE_ID_ALREADY_EXISTS),
    );
  });
});

describe("AuthAppleOauthService — 판매자(2026-11-26, 판매자 앱 심사 4.8)", () => {
  const httpClientMock = { post: vi.fn(), get: vi.fn() };
  const prismaMock = mockDeep<PrismaService>();
  const jwtUtilMock = {
    generateTokenPair: vi.fn(),
    generateRegisterTicket: vi.fn(),
    verifyRegisterTicket: vi.fn(),
  };
  const opsAlertMock = { notifyNewSeller: vi.fn() };
  const termsMock = { recordSellerAgreementsInTransaction: vi.fn() };
  const phoneMock = { checkPhoneVerificationStatus: vi.fn() };
  let service: AuthAppleOauthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue(httpClientMock as any);
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
    jwtUtilMock.generateRegisterTicket.mockResolvedValue("seller-register-ticket");
    jwtUtilMock.generateTokenPair.mockResolvedValue({
      accessToken: "seller-access",
      refreshToken: "seller-refresh",
    });
    jwtUtilMock.verifyRegisterTicket.mockResolvedValue({
      providerId: "apple-seller-1",
      email: "s@privaterelay.appleid.com",
    });
    phoneMock.checkPhoneVerificationStatus.mockResolvedValue(true);
    const values: Record<string, string> = {
      APPLE_TEAM_ID: "team-id",
      APPLE_KEY_ID: "key-id",
      APPLE_PRIVATE_KEY: "fake-private-key",
      APPLE_CLIENT_ID: "apple-client-id",
      NODE_ENV: "production",
      PUBLIC_SELLER_DOMAIN: "https://seller.example.test",
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthAppleOauthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtUtil, useValue: jwtUtilMock },
        { provide: ConfigService, useValue: { get: vi.fn((k: string) => values[k]) } },
        { provide: AuthPhoneService, useValue: phoneMock },
        { provide: TermsService, useValue: termsMock },
        {
          provide: TokenEncryptionUtil,
          useValue: { encrypt: vi.fn((p: string) => `enc:${p}`), decrypt: vi.fn() },
        },
        { provide: OpsAlertService, useValue: opsAlertMock },
      ],
    }).compile();
    service = moduleRef.get(AuthAppleOauthService);
  });

  function mockTokenExchange() {
    httpClientMock.post.mockResolvedValue({
      data: { id_token: "id-token", refresh_token: "apple-refresh" },
      status: 200,
    });
    vi.mocked(jwt.verify).mockImplementation((_t: any, _k: any, _o: any, cb: any) =>
      cb(null, { sub: "apple-seller-1", email: "s@privaterelay.appleid.com" }),
    );
  }

  it("토큰 교환 redirect_uri는 서버 Return URL(상용 api.picakes.com)이다 — 판매자 웹 authorize 주소와 같아야 함", async () => {
    mockTokenExchange();
    prismaMock.seller.findUnique.mockResolvedValue({
      id: "seller-1",
      isActive: true,
      phone: "01011112222",
      isPhoneVerified: true,
    } as any);

    const result = await service.sellerAppleLoginWithCode({ code: "c" });

    expect(result).toEqual({ accessToken: "seller-access", refreshToken: "seller-refresh" });
    const body = httpClientMock.post.mock.calls[0][1] as URLSearchParams;
    expect(body.get("redirect_uri")).toBe("https://api.picakes.com/v1/seller/auth/apple/callback");
    expect(jwtUtilMock.generateTokenPair).toHaveBeenCalledWith({ sub: "seller-1", aud: "seller" });
    expect(prismaMock.seller.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "seller-1" },
        data: expect.objectContaining({ appleRefreshToken: "enc:apple-refresh" }),
      }),
    );
    expect(prismaMock.consumer.findUnique).not.toHaveBeenCalled();
  });

  it("가입 안 한 애플이면 사장님용(aud seller) 가입표로 휴대폰 인증을 요구한다", async () => {
    mockTokenExchange();
    prismaMock.seller.findUnique.mockResolvedValue(null);

    await expect(service.sellerAppleLoginWithCode({ code: "c" })).rejects.toThrow(
      BadRequestException,
    );
    expect(jwtUtilMock.generateRegisterTicket).toHaveBeenCalledWith({
      aud: "seller",
      provider: "apple",
      providerId: "apple-seller-1",
      email: "s@privaterelay.appleid.com",
    });
  });

  it("비활성 사장님은 로그인이 막힌다", async () => {
    mockTokenExchange();
    prismaMock.seller.findUnique.mockResolvedValue({ id: "s", isActive: false } as any);
    await expect(service.sellerAppleLoginWithCode({ code: "c" })).rejects.toThrow(
      ForbiddenException,
    );
  });

  const registerDto = {
    registerToken: "t",
    name: " 김사장 ",
    phone: "01033334444",
    agreedToTerms: true,
    agreedToPrivacy: true,
    agreedToAge14: true,
    termsDocumentIds: ["doc-tos", "doc-privacy"],
  };

  it("가입: 판매자 가입표·apple_registration(seller) 인증으로 만들고 만 14세 시각·약관·새 사장님 알림을 남긴다", async () => {
    prismaMock.seller.findUnique.mockResolvedValue(null);
    prismaMock.seller.findFirst.mockResolvedValue(null);
    prismaMock.seller.create.mockResolvedValue({
      id: "new-seller",
      createdAt: new Date("2026-11-26T00:00:00Z"),
    } as any);

    const result = await service.sellerAppleRegisterWithPhone(registerDto);

    expect(result).toEqual({ accessToken: "seller-access", refreshToken: "seller-refresh" });
    expect(jwtUtilMock.verifyRegisterTicket).toHaveBeenCalledWith("t", {
      aud: "seller",
      provider: "apple",
    });
    expect(phoneMock.checkPhoneVerificationStatus).toHaveBeenCalledWith(
      "01033334444",
      "seller",
      "apple_registration",
    );
    const data = prismaMock.seller.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      appleId: "apple-seller-1",
      appleEmail: "s@privaterelay.appleid.com",
      name: "김사장",
      phone: "01033334444",
      isPhoneVerified: true,
      sellerVerificationStatus: "REGISTERED",
    });
    expect(data.ageConfirmedAt).toBeInstanceOf(Date);
    expect(termsMock.recordSellerAgreementsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      "new-seller",
      ["doc-tos", "doc-privacy"],
    );
    expect(opsAlertMock.notifyNewSeller).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-seller", method: "APPLE" }),
    );
  });

  it("가입: 만 14세 확인을 안 보내면(1단계) 막지 않고 빈 값으로 둔다", async () => {
    prismaMock.seller.findUnique.mockResolvedValue(null);
    prismaMock.seller.findFirst.mockResolvedValue(null);
    prismaMock.seller.create.mockResolvedValue({ id: "s2", createdAt: new Date() } as any);
    await service.sellerAppleRegisterWithPhone({ ...registerDto, agreedToAge14: undefined });
    expect(prismaMock.seller.create.mock.calls[0][0].data).toMatchObject({ ageConfirmedAt: null });
  });

  it("가입: 필수 약관을 안 했으면 400", async () => {
    await expect(
      service.sellerAppleRegisterWithPhone({ ...registerDto, agreedToPrivacy: false }),
    ).rejects.toThrow(new BadRequestException(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED));
  });

  it("가입: 같은 번호의 카카오 사장님이 있으면 그 수단을 알리는 409", async () => {
    prismaMock.seller.findUnique.mockResolvedValue(null);
    prismaMock.seller.findFirst.mockResolvedValue({
      isActive: true,
      phone: "01033334444",
      name: "김사장",
      kakaoId: "k1",
      kakaoEmail: "k@example.com",
    } as any);
    await expect(service.sellerAppleRegisterWithPhone(registerDto)).rejects.toThrow(
      ConflictException,
    );
    expect(prismaMock.seller.create).not.toHaveBeenCalled();
  });

  it("가입: 이미 그 애플로 가입한 사장님이면 409", async () => {
    prismaMock.seller.findUnique.mockResolvedValue({ id: "s", isActive: true } as any);
    await expect(service.sellerAppleRegisterWithPhone(registerDto)).rejects.toThrow(
      new ConflictException(AUTH_ERROR_MESSAGES.APPLE_ID_ALREADY_EXISTS),
    );
  });

  it("콜백: 애플 form_post를 판매자 웹 콜백 주소로 바꾼다(돌아갈 곳은 서버 설정 하나)", () => {
    const url = new URL(
      service.sellerAppleCallbackRedirectUrl({
        code: "abc",
        state: "s1",
        user: JSON.stringify({ name: { firstName: "길동", lastName: "홍" } }),
      }),
    );
    expect(url.origin).toBe("https://seller.example.test");
    expect(url.pathname).toBe("/auth/login/apple");
    expect(url.searchParams.get("code")).toBe("abc");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("appleName")).toBe("홍길동");
  });
});
