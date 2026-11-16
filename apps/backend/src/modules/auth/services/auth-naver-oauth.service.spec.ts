import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { TokenEncryptionUtil } from "@apps/backend/common/utils/token-encryption.util";
import { AUDIENCE, AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { TermsService } from "@apps/backend/modules/terms/terms.service";

import { AuthNaverOauthService } from "./auth-naver-oauth.service";

vi.mock("axios", () => ({
  default: { create: vi.fn() },
}));

const ENCRYPTION_KEY = "a".repeat(64);

function buildConfig(values: Record<string, string>): Partial<ConfigService> {
  return { get: vi.fn((key: string) => values[key]) as any };
}

const BASE_CONFIG = {
  NAVER_CLIENT_ID: "naver-client-id",
  NAVER_CLIENT_SECRET: "naver-client-secret",
  APPLE_REFRESH_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
  NODE_ENV: "test",
};

async function createService(opts: {
  config?: Record<string, string>;
  prisma: ReturnType<typeof mockDeep<PrismaService>>;
  jwtUtil: unknown;
  phone?: unknown;
  terms?: unknown;
  opsAlert?: unknown;
}) {
  const config = buildConfig({ ...BASE_CONFIG, ...(opts.config ?? {}) });
  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthNaverOauthService,
      { provide: PrismaService, useValue: opts.prisma },
      { provide: JwtUtil, useValue: opts.jwtUtil },
      { provide: ConfigService, useValue: config },
      { provide: AuthPhoneService, useValue: opts.phone ?? {} },
      { provide: TermsService, useValue: opts.terms ?? {} },
      { provide: OpsAlertService, useValue: opts.opsAlert ?? { notifyNewSeller: vi.fn() } },
      { provide: TokenEncryptionUtil, useValue: new TokenEncryptionUtil(config as ConfigService) },
    ],
  }).compile();
  return moduleRef.get(AuthNaverOauthService);
}

describe("AuthNaverOauthService — 로그인", () => {
  const httpClientMock = { post: vi.fn(), get: vi.fn() };
  const prismaMock = mockDeep<PrismaService>();
  const jwtUtilMock = { generateTokenPair: vi.fn(), generateRegisterTicket: vi.fn() };
  let service: AuthNaverOauthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue(httpClientMock as any);
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
    jwtUtilMock.generateRegisterTicket.mockResolvedValue("test-register-ticket");
    jwtUtilMock.generateTokenPair.mockResolvedValue({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    service = await createService({ prisma: prismaMock, jwtUtil: jwtUtilMock });
  });

  function mockNaver(profile: Record<string, unknown>, token: Record<string, unknown> = {}) {
    httpClientMock.post.mockResolvedValue({
      data: { access_token: "naver-access", refresh_token: "naver-refresh", ...token },
      status: 200,
    });
    httpClientMock.get.mockResolvedValue({
      data: { resultcode: "00", message: "success", response: profile },
      status: 200,
    });
  }

  it("토큰 발급에 code·state·키를 그대로 넘기고 프로필을 묻는다", async () => {
    mockNaver({ id: "naver-1" });
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    await expect(
      service.consumerNaverLoginWithCode({ code: "c-1", state: "s-1" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const [url, body] = httpClientMock.post.mock.calls[0];
    expect(url).toBe("https://nid.naver.com/oauth2.0/token");
    const params = new URLSearchParams(body as URLSearchParams);
    expect(Object.fromEntries(params)).toEqual({
      grant_type: "authorization_code",
      client_id: "naver-client-id",
      client_secret: "naver-client-secret",
      code: "c-1",
      state: "s-1",
    });
    expect(httpClientMock.get).toHaveBeenCalledWith("https://openapi.naver.com/v1/nid/me", {
      headers: { Authorization: "Bearer naver-access" },
    });
  });

  it("처음이면 네이버가 준 이름·번호와 암호화한 갱신 토큰을 가입표에 담는다(이메일 없음)", async () => {
    mockNaver({ id: "naver-1", name: " 홍길동 ", mobile: "010-1234-5678" });
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    await expect(
      service.consumerNaverLoginWithCode({ code: "c", state: "s" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
        registerToken: "test-register-ticket",
      }),
    });
    const ticket = jwtUtilMock.generateRegisterTicket.mock.calls[0][0];
    expect(ticket).toMatchObject({
      aud: "consumer",
      provider: "naver",
      providerId: "naver-1",
      email: "",
      phone: "01012345678",
      name: "홍길동",
    });
    // 갱신 토큰은 평문으로 담지 않는다
    expect(ticket.providerRefreshToken).toBeTypeOf("string");
    expect(ticket.providerRefreshToken).not.toContain("naver-refresh");
  });

  it("번호·이름 동의가 없으면 가입표에도 없다(가입 화면이 문자 인증으로 받음)", async () => {
    mockNaver({ id: "naver-1", mobile: "+1 650-555-1234" });
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    await expect(service.consumerNaverLoginWithCode({ code: "c", state: "s" })).rejects.toThrow();
    const ticket = jwtUtilMock.generateRegisterTicket.mock.calls[0][0];
    expect(ticket.phone).toBeUndefined();
    expect(ticket.name).toBeUndefined();
  });

  it("가입된 활성 손님이면 토큰을 주고 마지막 로그인·갱신 토큰(암호화)을 저장한다", async () => {
    mockNaver({ id: "naver-1" });
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: "consumer-1",
      naverId: "naver-1",
      isActive: true,
      phone: "01012345678",
      isPhoneVerified: true,
    } as any);

    const result = await service.consumerNaverLoginWithCode({ code: "c", state: "s" });

    expect(result).toEqual({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    const data = prismaMock.consumer.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.lastLoginAt).toBeInstanceOf(Date);
    expect(typeof data.naverRefreshToken).toBe("string");
    expect(data.naverRefreshToken).not.toBe("naver-refresh");
  });

  it("정지된 계정은 로그인할 수 없다", async () => {
    mockNaver({ id: "naver-1" });
    prismaMock.consumer.findUnique.mockResolvedValue({ id: "c", isActive: false } as any);

    await expect(
      service.consumerNaverLoginWithCode({ code: "c", state: "s" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("사장님 로그인은 사장님 계정에서 찾는다", async () => {
    mockNaver({ id: "naver-1", mobile: "010-2222-3333" });
    prismaMock.seller.findUnique.mockResolvedValue(null);

    await expect(service.sellerNaverLoginWithCode({ code: "c", state: "s" })).rejects.toThrow();
    expect(prismaMock.seller.findUnique).toHaveBeenCalledWith({ where: { naverId: "naver-1" } });
    expect(jwtUtilMock.generateRegisterTicket.mock.calls[0][0]).toMatchObject({
      aud: "seller",
      provider: "naver",
      phone: "01022223333",
    });
  });

  it.each([
    ["네이버가 200에 error를 담아 주면", { error: "invalid_request", access_token: undefined }],
    ["접근 토큰이 없으면", { access_token: "" }],
  ])("%s 토큰 교환 실패", async (_label, token) => {
    httpClientMock.post.mockResolvedValue({ data: { ...token }, status: 200 });

    await expect(service.consumerNaverLoginWithCode({ code: "c", state: "s" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
    expect(httpClientMock.get).not.toHaveBeenCalled();
  });

  it("프로필 결과가 실패거나 회원 식별자가 없으면 토큰 교환 실패", async () => {
    httpClientMock.post.mockResolvedValue({ data: { access_token: "a" }, status: 200 });
    httpClientMock.get.mockResolvedValue({
      data: { resultcode: "024", message: "Authentication failed" },
      status: 401,
    });

    await expect(service.consumerNaverLoginWithCode({ code: "c", state: "s" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
  });

  it("네이버 키가 없으면 네이버를 부르지 않고 실패", async () => {
    const noKey = await createService({
      prisma: prismaMock,
      jwtUtil: jwtUtilMock,
      config: { NAVER_CLIENT_ID: "", NAVER_CLIENT_SECRET: "" },
    });

    await expect(noKey.consumerNaverLoginWithCode({ code: "c", state: "s" })).rejects.toThrow(
      AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED,
    );
    expect(httpClientMock.post).not.toHaveBeenCalled();
  });
});

describe("AuthNaverOauthService — 회원가입", () => {
  const prismaMock = mockDeep<PrismaService>();
  const jwtUtil = new JwtUtil(new JwtService({ secret: "test-secret" }), {} as any);
  const phoneMock = { checkPhoneVerificationStatus: vi.fn() };
  const termsMock = {
    recordConsumerAgreementsInTransaction: vi.fn(),
    recordSellerAgreementsInTransaction: vi.fn(),
  };
  const opsAlertMock = { notifyNewSeller: vi.fn() };
  let service: AuthNaverOauthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue({ post: vi.fn(), get: vi.fn() } as any);
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
    prismaMock.consumer.findUnique.mockResolvedValue(null);
    prismaMock.consumer.findFirst.mockResolvedValue(null);
    prismaMock.seller.findUnique.mockResolvedValue(null);
    prismaMock.seller.findFirst.mockResolvedValue(null);
    prismaMock.consumer.create.mockResolvedValue({ id: "new-consumer" } as any);
    prismaMock.seller.create.mockResolvedValue({ id: "new-seller", createdAt: new Date() } as any);
    phoneMock.checkPhoneVerificationStatus.mockResolvedValue(false);
    service = await createService({
      prisma: prismaMock,
      jwtUtil,
      phone: phoneMock,
      terms: termsMock,
      opsAlert: opsAlertMock,
    });
  });

  function ticket(aud: "consumer" | "seller", extra: Record<string, unknown> = {}) {
    return jwtUtil.generateRegisterTicket({
      aud,
      provider: "naver",
      providerId: "naver-1",
      email: "",
      phone: "01012345678",
      name: "홍길동",
      providerRefreshToken: "enc-refresh",
      ...extra,
    });
  }

  const consumerTerms = { agreedToTerms: true, agreedToPrivacy: true, agreedToThirdParty: true };

  it("네이버 번호로 가입하면 문자 인증 없이 가입표의 번호·갱신 토큰으로 만든다", async () => {
    const result = await service.consumerNaverRegisterWithPhone({
      registerToken: await ticket("consumer"),
      useTicketPhone: true,
      name: "홍길동",
      ...consumerTerms,
      termsDocumentIds: ["t1", "t2", "t3"],
    });

    expect(result.accessToken).toBeTypeOf("string");
    expect(phoneMock.checkPhoneVerificationStatus).not.toHaveBeenCalled();
    expect(prismaMock.consumer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        naverId: "naver-1",
        naverRefreshToken: "enc-refresh",
        phone: "01012345678",
        name: "홍길동",
        isPhoneVerified: true,
      }),
    });
    expect(termsMock.recordConsumerAgreementsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      "new-consumer",
      ["t1", "t2", "t3"],
    );
  });

  it("화면이 보낸 번호는 네이버 번호로 가입할 때 무시한다", async () => {
    await service.consumerNaverRegisterWithPhone({
      registerToken: await ticket("consumer"),
      useTicketPhone: true,
      phone: "01099998888",
      name: "홍길동",
      ...consumerTerms,
    });
    expect(prismaMock.consumer.create.mock.calls[0][0].data.phone).toBe("01012345678");
  });

  it("다른 번호면 문자 인증(naver_registration)을 마쳐야 한다", async () => {
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: await ticket("consumer"),
        phone: "010-9999-8888",
        name: "홍길동",
        ...consumerTerms,
      }),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED);
    expect(phoneMock.checkPhoneVerificationStatus).toHaveBeenCalledWith(
      "01099998888",
      AUDIENCE.CONSUMER,
      "naver_registration",
    );

    phoneMock.checkPhoneVerificationStatus.mockResolvedValue(true);
    await service.consumerNaverRegisterWithPhone({
      registerToken: await ticket("consumer"),
      phone: "010-9999-8888",
      name: "홍길동",
      ...consumerTerms,
    });
    expect(prismaMock.consumer.create.mock.calls[0][0].data.phone).toBe("01099998888");
  });

  it("가입표에 네이버 번호가 없는데 네이버 번호로 가입하려 하면 막는다", async () => {
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: await ticket("consumer", { phone: undefined }),
        useTicketPhone: true,
        name: "홍길동",
        ...consumerTerms,
      }),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED);
    expect(prismaMock.consumer.create).not.toHaveBeenCalled();
  });

  it("필수 약관에 다 동의하지 않으면 가입하지 않는다(네이버는 약관을 늘 화면에서 받음)", async () => {
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: await ticket("consumer"),
        useTicketPhone: true,
        name: "홍길동",
        agreedToTerms: true,
        agreedToPrivacy: true,
        agreedToThirdParty: false,
      }),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
  });

  it("다른 소셜이나 다른 대상의 가입표는 받지 않는다", async () => {
    const kakaoTicket = await jwtUtil.generateRegisterTicket({
      aud: "consumer",
      provider: "kakao",
      providerId: "k-1",
      email: "a@b.c",
    });
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: kakaoTicket,
        useTicketPhone: true,
        name: "홍길동",
        ...consumerTerms,
      }),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID);
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: await ticket("seller"),
        useTicketPhone: true,
        name: "홍길동",
        ...consumerTerms,
      }),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID);
  });

  it("이미 이 네이버로 가입했으면 409", async () => {
    prismaMock.consumer.findUnique.mockResolvedValue({ id: "c", isActive: true } as any);
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: await ticket("consumer"),
        useTicketPhone: true,
        name: "홍길동",
        ...consumerTerms,
      }),
    ).rejects.toThrow(new ConflictException(AUTH_ERROR_MESSAGES.NAVER_ID_ALREADY_EXISTS));
  });

  it("번호를 다른 소셜 계정이 쓰고 있으면 그 수단을 가려서 알린다", async () => {
    prismaMock.consumer.findFirst.mockResolvedValue({
      id: "c",
      isActive: true,
      name: "홍길동",
      phone: "01012345678",
      kakaoId: "k-1",
      kakaoEmail: "hong@kakao.com",
    } as any);
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: await ticket("consumer"),
        useTicketPhone: true,
        name: "홍길동",
        ...consumerTerms,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: AUTH_ERROR_MESSAGES.PHONE_KAKAO_ACCOUNT_EXISTS,
        name: "홍*동",
      }),
    });
    expect(prismaMock.consumer.create).not.toHaveBeenCalled();
  });

  it("번호를 다른 네이버 계정이 쓰고 있으면 네이버 계정이 있다고 알린다(이메일 없음)", async () => {
    prismaMock.consumer.findFirst.mockResolvedValue({
      id: "c",
      isActive: true,
      name: "홍길동",
      phone: "01012345678",
      naverId: "naver-other",
    } as any);
    await expect(
      service.consumerNaverRegisterWithPhone({
        registerToken: await ticket("consumer"),
        useTicketPhone: true,
        name: "홍길동",
        ...consumerTerms,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: AUTH_ERROR_MESSAGES.PHONE_NAVER_ACCOUNT_EXISTS,
        email: null,
      }),
    });
  });

  it("사장님 가입: 네이버 번호로 만들고 운영자에게 새 사장님(네이버)을 알린다", async () => {
    await service.sellerNaverRegisterWithPhone({
      registerToken: await ticket("seller"),
      useTicketPhone: true,
      name: "김사장",
      agreedToTerms: true,
      agreedToPrivacy: true,
      termsDocumentIds: ["s1", "s2"],
    });

    expect(prismaMock.seller.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        naverId: "naver-1",
        naverRefreshToken: "enc-refresh",
        phone: "01012345678",
        name: "김사장",
        sellerVerificationStatus: "REGISTERED",
      }),
    });
    expect(opsAlertMock.notifyNewSeller).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-seller", method: "NAVER" }),
    );
  });

  it("사장님 가입: 필수 약관 둘(이용약관·처리방침)에 동의해야 한다", async () => {
    await expect(
      service.sellerNaverRegisterWithPhone({
        registerToken: await ticket("seller"),
        useTicketPhone: true,
        name: "김사장",
        agreedToTerms: true,
        agreedToPrivacy: false,
      }),
    ).rejects.toThrow(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
  });
});

describe("AuthNaverOauthService.revoke — 탈퇴 때 네이버 연결 끊기", () => {
  const httpClientMock = { post: vi.fn(), get: vi.fn() };
  const prismaMock = mockDeep<PrismaService>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue(httpClientMock as any);
  });

  it("상용이면 저장해 둔 갱신 토큰을 풀어 네이버에 폐기를 요청한다", async () => {
    const service = await createService({
      prisma: prismaMock,
      jwtUtil: {},
      config: { NODE_ENV: "production" },
    });
    const enc = new TokenEncryptionUtil(
      buildConfig({ APPLE_REFRESH_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY }) as ConfigService,
    ).encrypt("plain-refresh");
    httpClientMock.post.mockResolvedValue({ status: 200, data: "" });

    await service.revoke("consumer", enc);

    const [url, body] = httpClientMock.post.mock.calls[0];
    expect(url).toBe("https://nid.naver.com/oauth2.0/revoke");
    expect(Object.fromEntries(new URLSearchParams(body as URLSearchParams))).toEqual({
      client_id: "naver-client-id",
      client_secret: "naver-client-secret",
      token: "plain-refresh",
      token_type_hint: "refresh_token",
    });
  });

  it("사장님 탈퇴는 사장님 키로 끊는다(사장님 앱을 나눴을 때)", async () => {
    const service = await createService({
      prisma: prismaMock,
      jwtUtil: {},
      config: {
        NODE_ENV: "production",
        NAVER_CLIENT_ID_SELLER: "seller-id",
        NAVER_CLIENT_SECRET_SELLER: "seller-secret",
      },
    });
    const enc = new TokenEncryptionUtil(
      buildConfig({ APPLE_REFRESH_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY }) as ConfigService,
    ).encrypt("plain-refresh");
    httpClientMock.post.mockResolvedValue({ status: 200, data: "" });

    await service.revoke("seller", enc);

    const params = Object.fromEntries(
      new URLSearchParams(httpClientMock.post.mock.calls[0][1] as URLSearchParams),
    );
    expect(params.client_id).toBe("seller-id");
    expect(params.client_secret).toBe("seller-secret");
  });

  it("상용이 아니면 끊지 않는다(staging·로컬도 같은 네이버 앱)", async () => {
    const service = await createService({ prisma: prismaMock, jwtUtil: {} });
    await service.revoke("consumer", "anything");
    expect(httpClientMock.post).not.toHaveBeenCalled();
  });

  it("토큰이 없거나 풀 수 없거나 네이버가 실패해도 탈퇴를 막지 않는다", async () => {
    const service = await createService({
      prisma: prismaMock,
      jwtUtil: {},
      config: { NODE_ENV: "production" },
    });
    await expect(service.revoke("consumer", null)).resolves.toBeUndefined();
    await expect(service.revoke("consumer", "not-encrypted")).resolves.toBeUndefined();
    expect(httpClientMock.post).not.toHaveBeenCalled();

    const enc = new TokenEncryptionUtil(
      buildConfig({ APPLE_REFRESH_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY }) as ConfigService,
    ).encrypt("plain-refresh");
    httpClientMock.post.mockRejectedValue(new Error("network"));
    await expect(service.revoke("consumer", enc)).resolves.toBeUndefined();
    httpClientMock.post.mockResolvedValue({ status: 401, data: { error: "unauthorized_client" } });
    await expect(service.revoke("consumer", enc)).resolves.toBeUndefined();
  });
});
