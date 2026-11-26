import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import {
  Injectable,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import {
  AUTH_ERROR_MESSAGES,
  AUDIENCE,
  AudienceConst,
  PhoneVerificationPurpose,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { NaverUserInfo } from "@apps/backend/modules/auth/types/auth.types";
import { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import { PhoneUtil } from "@apps/backend/modules/auth/utils/phone.util";
import {
  NaverLoginRequestDto,
  NaverRegisterRequestDto,
} from "@apps/backend/modules/auth/dto/auth-naver-oauth.dto";
import { buildInitialNickname } from "@apps/backend/modules/auth/utils/register-nickname.util";
import {
  socialNameToDisplay,
  socialPhoneToLocal,
} from "@apps/backend/modules/auth/utils/social-signup.util";
import { phoneTakenConflict } from "@apps/backend/modules/auth/utils/phone-conflict.util";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { TokenEncryptionUtil } from "@apps/backend/common/utils/token-encryption.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { TermsService } from "@apps/backend/modules/terms/terms.service";
import { rethrowRegisterUniqueConflict } from "@apps/backend/modules/auth/utils/register-conflict.util";

/** 토큰 발급·갱신·삭제(연동 해제)를 모두 받는 곳 — grant_type으로 나눈다(네이버 로그인 API 명세) */
const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token";
/** 연동 해제(Token Revocation) — 2026-05부터 네이버 공식 명세(옛 `/oauth2.0/token?grant_type=delete`는 명세에서 빠짐) */
const NAVER_REVOKE_URL = "https://nid.naver.com/oauth2.0/revoke";
const NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me";

/**
 * 네이버 로그인(손님·사장님). 카카오처럼 네이버 동의 화면에서 이름·휴대전화번호를 받아 가입표에 담고,
 * 가입 화면은 그 번호로 문자 인증 없이 가입한다("다른 번호"면 문자 인증). 네이버는 약관을 동의 화면에 넣을 수 없어
 * 약관은 늘 가입 화면에서 받는다. 손님·사장님이 네이버 앱 하나를 같이 써서 같은 사람의 naverId가 같다.
 *
 * - 로그인 요청에는 화면이 만든 state가 붙고(CSRF 막기 — 화면이 콜백에서 자기 것과 같은지 먼저 확인),
 *   토큰 발급 때 그 state를 그대로 넘긴다(네이버 필수).
 * - 탈퇴 때 연결을 끊으려면(토큰 폐기) 네이버 토큰이 있어야 해서, 갱신 토큰을 암호화해 저장한다(로그인마다 새로).
 */
@Injectable()
export class AuthNaverOauthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly clientIdSeller: string;
  private readonly clientSecretSeller: string;
  /**
   * 탈퇴 때 네이버 연결 끊기는 상용만. staging·로컬도 같은 네이버 앱을 써서, 거기서 끊으면
   * 같은 네이버 계정의 상용 연결까지 끊긴다(카카오 연결 끊기와 같은 이유).
   */
  private readonly revokeOnWithdraw: boolean;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtUtil: JwtUtil,
    private readonly configService: ConfigService,
    private readonly authPhoneService: AuthPhoneService,
    private readonly termsService: TermsService,
    private readonly opsAlert: OpsAlertService,
    private readonly tokenEncryptionUtil: TokenEncryptionUtil,
  ) {
    this.clientId = configService.get<string>("NAVER_CLIENT_ID")?.trim() ?? "";
    this.clientSecret = configService.get<string>("NAVER_CLIENT_SECRET")?.trim() ?? "";
    // 사장님도 지금은 같은 네이버 앱. _SELLER는 ID·SECRET이 둘 다 있을 때만 쓴다(하나만 넣으면 손님 ID + 사장님 SECRET처럼 짝이 어긋남).
    // 앱을 나누면 네이버 회원 식별자가 앱마다 달라져 기존 네이버 사장님을 새 앱 id로 옮기는 일이 따로 필요하다(_SELLER만 넣어서는 안 됨)
    const sellerId = configService.get<string>("NAVER_CLIENT_ID_SELLER")?.trim() ?? "";
    const sellerSecret = configService.get<string>("NAVER_CLIENT_SECRET_SELLER")?.trim() ?? "";
    const useSellerPair = Boolean(sellerId && sellerSecret);
    this.clientIdSeller = useSellerPair ? sellerId : this.clientId;
    this.clientSecretSeller = useSellerPair ? sellerSecret : this.clientSecret;
    this.revokeOnWithdraw = configService.get<string>("NODE_ENV") === "production";
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        "User-Agent": "Picake-Backend/1.0",
        Accept: "application/json",
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
  }

  async consumerNaverLoginWithCode(dto: NaverLoginRequestDto) {
    const naverUserInfo = await this.exchangeCodeForToken(dto.code, dto.state, {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });
    return this.naverLogin(naverUserInfo);
  }

  async sellerNaverLoginWithCode(dto: NaverLoginRequestDto) {
    const naverUserInfo = await this.exchangeCodeForToken(dto.code, dto.state, {
      clientId: this.clientIdSeller,
      clientSecret: this.clientSecretSeller,
    });
    return this.naverLoginSeller(naverUserInfo);
  }

  private reportFailure(operation: string, details: Record<string, unknown>, error: unknown) {
    ExternalApiErrorUtil.reportFailure(
      { provider: "naver", module: "auth-naver-oauth", operation, details },
      error,
    );
  }

  /**
   * code + state로 접근 토큰을 받고 프로필(회원 식별자·이름·휴대전화번호)을 묻는다.
   * 네이버는 실패해도 HTTP 200에 `error`를 담아 주기도 해서 access_token이 있는지로 판단한다.
   * @throws BadRequestException `NAVER_OAUTH_TOKEN_EXCHANGE_FAILED` — 키 없음·code 만료·state 불일치·프로필 실패
   */
  private async exchangeCodeForToken(
    code: string,
    state: string,
    credentials: { clientId: string; clientSecret: string },
  ): Promise<NaverUserInfo> {
    const { clientId, clientSecret } = credentials;
    if (!clientId || !clientSecret) {
      this.reportFailure("config", {}, new Error("NAVER_CLIENT_ID/SECRET 없음"));
      throw new BadRequestException(AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED);
    }
    try {
      const tokenResponse = await this.httpClient.post(
        NAVER_TOKEN_URL,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code,
          state,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" } },
      );
      const accessToken: unknown = tokenResponse.data?.access_token;
      if (typeof accessToken !== "string" || !accessToken) {
        const failure = {
          provider: "naver",
          module: "auth-naver-oauth",
          operation: "token-exchange",
          ...ExternalApiErrorUtil.fromResponseBody(tokenResponse.data, tokenResponse.status),
        };
        ExternalApiErrorUtil.reportFailure(
          failure,
          ExternalApiErrorUtil.createFailureError(failure, "no_access_token"),
        );
        throw new BadRequestException(AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED);
      }
      const refreshToken: unknown = tokenResponse.data?.refresh_token;

      const profileResponse = await this.httpClient.get(NAVER_PROFILE_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = profileResponse.data as
        | { resultcode?: unknown; response?: { id?: unknown; name?: unknown; mobile?: unknown } }
        | undefined;
      const naverId = typeof body?.response?.id === "string" ? body.response.id : "";
      if (body?.resultcode !== "00" || !naverId) {
        const failure = {
          provider: "naver",
          module: "auth-naver-oauth",
          operation: "profile",
          ...ExternalApiErrorUtil.fromResponseBody(body, profileResponse.status),
          // 네이버 프로필은 오류를 error·code가 아니라 resultcode·message로 준다
          details: {
            hasNaverId: Boolean(naverId),
            resultcode: (body as { resultcode?: unknown } | undefined)?.resultcode ?? null,
            message: (body as { message?: unknown } | undefined)?.message ?? null,
          },
        };
        ExternalApiErrorUtil.reportFailure(
          failure,
          ExternalApiErrorUtil.createFailureError(failure, "missing_id"),
        );
        throw new BadRequestException(AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED);
      }

      return {
        userInfo: {
          naverId,
          // 제공 동의를 받았을 때만 들어 있다 — 가입이 필요할 때 가입표에 담는다
          phone: socialPhoneToLocal(body.response?.mobile),
          name: socialNameToDisplay(body.response?.name),
        },
        ...(typeof refreshToken === "string" && refreshToken ? { refreshToken } : {}),
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const failure = {
        provider: "naver",
        module: "auth-naver-oauth",
        operation: "exchange-code-for-token",
        ...ExternalApiErrorUtil.fromAxiosError(error),
      };
      ExternalApiErrorUtil.reportFailure(failure, error);
      throw new BadRequestException(AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED);
    }
  }

  /** 갱신 토큰을 저장용으로 암호화(없거나 실패하면 undefined — 로그인·가입은 그대로) */
  private encryptRefreshToken(refreshToken: string | undefined): string | undefined {
    if (!refreshToken) return undefined;
    try {
      return this.tokenEncryptionUtil.encrypt(refreshToken);
    } catch (error) {
      this.reportFailure("encrypt-refresh-token", {}, error);
      return undefined;
    }
  }

  /**
   * 가입이 필요할 때(400 PHONE_VERIFICATION_REQUIRED) 화면에 줄 응답.
   * 서버가 네이버에 직접 확인한 회원 식별자·이름·번호를 가입표(registerToken, 30분)에 담는다 — 가입 API는 이 가입표로만 가입시킨다.
   * 갱신 토큰은 암호화한 값만 담는다(화면은 풀 수 없음). 네이버는 이메일을 받지 않아 email은 빈 값.
   */
  private async buildRegisterRequiredError(
    aud: AudienceConst,
    naverUserInfo: NaverUserInfo,
  ): Promise<BadRequestException> {
    const { naverId, phone, name } = naverUserInfo.userInfo;
    const providerRefreshToken = this.encryptRefreshToken(naverUserInfo.refreshToken);
    const registerToken = await this.jwtUtil.generateRegisterTicket({
      aud,
      provider: "naver",
      providerId: naverId,
      email: "",
      phone,
      name,
      ...(providerRefreshToken ? { providerRefreshToken } : {}),
    });
    return new BadRequestException({
      message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
      registerToken,
    });
  }

  /** 가입 때 쓸 휴대폰 번호 — 가입표의 네이버 번호(문자 인증 없음)나 화면이 보낸 번호(문자 인증 필요) */
  private resolveRegisterPhone(dto: NaverRegisterRequestDto, ticket: { phone?: string }): string {
    if (dto.useTicketPhone === true) {
      if (!ticket.phone) {
        throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED);
      }
      return ticket.phone;
    }
    if (!dto.phone) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED);
    }
    return PhoneUtil.normalizePhone(dto.phone);
  }

  private async naverLogin(naverUserInfo: NaverUserInfo) {
    const { naverId } = naverUserInfo.userInfo;
    const consumer = await this.prisma.consumer.findUnique({ where: { naverId } });

    if (!consumer) {
      throw await this.buildRegisterRequiredError(AUDIENCE.CONSUMER, naverUserInfo);
    }
    // 관리자 비활성 계정은 로그인·재가입 모두 불가 (계정·데이터 유지)
    if (!consumer.isActive) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }
    if (!consumer.phone || !consumer.isPhoneVerified) {
      throw await this.buildRegisterRequiredError(AUDIENCE.CONSUMER, naverUserInfo);
    }
    const naverRefreshToken = this.encryptRefreshToken(naverUserInfo.refreshToken);
    return await this.prisma.$transaction(async (tx) => {
      const tokenPair = await this.jwtUtil.generateTokenPair({
        sub: consumer.id,
        aud: AUDIENCE.CONSUMER,
      });
      await tx.consumer.update({
        where: { id: consumer.id },
        // 갱신 토큰은 로그인마다 새것으로 — 탈퇴 때 연결 끊기에 쓴다
        data: { lastLoginAt: new Date(), ...(naverRefreshToken ? { naverRefreshToken } : {}) },
      });
      return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
    });
  }

  private async naverLoginSeller(naverUserInfo: NaverUserInfo) {
    const { naverId } = naverUserInfo.userInfo;
    const seller = await this.prisma.seller.findUnique({ where: { naverId } });

    if (!seller) {
      throw await this.buildRegisterRequiredError(AUDIENCE.SELLER, naverUserInfo);
    }
    if (!seller.isActive) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }
    if (!seller.phone || !seller.isPhoneVerified) {
      throw await this.buildRegisterRequiredError(AUDIENCE.SELLER, naverUserInfo);
    }
    const naverRefreshToken = this.encryptRefreshToken(naverUserInfo.refreshToken);
    return await this.prisma.$transaction(async (tx) => {
      const tokenPair = await this.jwtUtil.generateTokenPair({
        sub: seller.id,
        aud: AUDIENCE.SELLER,
      });
      await tx.seller.update({
        where: { id: seller.id },
        data: { lastLoginAt: new Date(), ...(naverRefreshToken ? { naverRefreshToken } : {}) },
      });
      return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
    });
  }

  async consumerNaverRegisterWithPhone(dto: NaverRegisterRequestDto) {
    const { name, agreedToTerms, agreedToPrivacy, agreedToThirdParty, agreedToAge14 } = dto;
    const ticket = await this.jwtUtil.verifyRegisterTicket(dto.registerToken, {
      aud: AUDIENCE.CONSUMER,
      provider: "naver",
    });
    const naverId = ticket.providerId;
    const trimmedName = name.trim();
    // 네이버 번호로 가입하면 그 번호(문자 인증 없음), 아니면 문자로 인증한 번호
    const normalizedPhone = this.resolveRegisterPhone(dto, ticket);

    // 1. 필수 약관 동의 — 네이버는 약관을 동의 화면에 넣을 수 없어 늘 가입 화면에서 받는다
    if (!agreedToTerms || !agreedToPrivacy || !agreedToThirdParty) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
    }

    const existing = await this.prisma.consumer.findUnique({ where: { naverId } });
    if (existing) {
      if (!existing.isActive) {
        throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
      }
      throw new ConflictException(AUTH_ERROR_MESSAGES.NAVER_ID_ALREADY_EXISTS);
    }

    const isPhoneVerified =
      dto.useTicketPhone === true ||
      (await this.authPhoneService.checkPhoneVerificationStatus(
        normalizedPhone,
        AUDIENCE.CONSUMER,
        PhoneVerificationPurpose.NAVER_REGISTRATION,
      ));
    if (!isPhoneVerified) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED);
    }

    const existingPhone = await this.prisma.consumer.findFirst({
      where: { phone: normalizedPhone },
    });
    if (existingPhone && !existingPhone.isActive) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }
    const phoneConflict = phoneTakenConflict(existingPhone, ["naver", "kakao", "google", "apple"]);
    if (phoneConflict) {
      throw phoneConflict;
    }

    return await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.consumer.create({
          data: {
            naverId,
            naverRefreshToken: ticket.providerRefreshToken ?? null,
            phone: normalizedPhone,
            name: trimmedName,
            nickname: buildInitialNickname(),
            isPhoneVerified: true,
            ageConfirmedAt: agreedToAge14 === true ? new Date() : null,
            lastLoginAt: new Date(),
          },
        });
        // 약관 버전 동의 이력 기록
        await this.termsService.recordConsumerAgreementsInTransaction(
          tx,
          row.id,
          dto.termsDocumentIds ?? [],
        );
        const tokenPair = await this.jwtUtil.generateTokenPair({
          sub: row.id,
          aud: AUDIENCE.CONSUMER,
        });
        return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
      })
      .catch((e: unknown) =>
        rethrowRegisterUniqueConflict(e, AUTH_ERROR_MESSAGES.NAVER_ID_ALREADY_EXISTS),
      );
  }

  async sellerNaverRegisterWithPhone(dto: NaverRegisterRequestDto) {
    const { name, agreedToTerms, agreedToPrivacy, agreedToAge14 } = dto;
    const ticket = await this.jwtUtil.verifyRegisterTicket(dto.registerToken, {
      aud: AUDIENCE.SELLER,
      provider: "naver",
    });
    const naverId = ticket.providerId;
    const trimmedName = name.trim();
    const normalizedPhone = this.resolveRegisterPhone(dto, ticket);

    if (!agreedToTerms || !agreedToPrivacy) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
    }

    const existing = await this.prisma.seller.findUnique({ where: { naverId } });
    if (existing) {
      if (!existing.isActive) {
        throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
      }
      throw new ConflictException(AUTH_ERROR_MESSAGES.NAVER_ID_ALREADY_EXISTS);
    }

    const isPhoneVerified =
      dto.useTicketPhone === true ||
      (await this.authPhoneService.checkPhoneVerificationStatus(
        normalizedPhone,
        AUDIENCE.SELLER,
        PhoneVerificationPurpose.NAVER_REGISTRATION,
      ));
    if (!isPhoneVerified) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED);
    }

    const existingPhone = await this.prisma.seller.findFirst({
      where: { phone: normalizedPhone },
    });
    if (existingPhone && !existingPhone.isActive) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }
    const phoneConflict = phoneTakenConflict(existingPhone, ["naver", "kakao", "google", "apple"]);
    if (phoneConflict) {
      throw phoneConflict;
    }

    const result = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.seller.create({
          data: {
            naverId,
            naverRefreshToken: ticket.providerRefreshToken ?? null,
            phone: normalizedPhone,
            name: trimmedName,
            nickname: buildInitialNickname(),
            isPhoneVerified: true,
            ageConfirmedAt: agreedToAge14 === true ? new Date() : null,
            lastLoginAt: new Date(),
            sellerVerificationStatus: "REGISTERED",
          },
        });
        await this.termsService.recordSellerAgreementsInTransaction(
          tx,
          row.id,
          dto.termsDocumentIds ?? [],
        );
        const tokenPair = await this.jwtUtil.generateTokenPair({
          sub: row.id,
          aud: AUDIENCE.SELLER,
        });
        return {
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          sellerId: row.id,
          createdAt: row.createdAt,
        };
      })
      .catch((e: unknown) =>
        rethrowRegisterUniqueConflict(e, AUTH_ERROR_MESSAGES.NAVER_ID_ALREADY_EXISTS),
      );

    // 새 사장님 가입을 운영자에게 바로 알린다(기획 I-56). 실패해도 가입은 그대로
    void this.opsAlert.notifyNewSeller({
      id: result.sellerId,
      method: "NAVER",
      createdAt: result.createdAt,
    });
    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  /**
   * 탈퇴할 때 네이버 연결을 끊는다(네이버 권장 — 서비스 탈퇴 시 연동 해제). 끊으면 네이버 "연결된 서비스"에서 빠지고,
   * 다시 가입할 때 정보 제공 동의부터 새로 본다. 상용에서만 끊는다(staging·로컬은 같은 네이버 앱이라).
   * 실패해도 탈퇴는 그대로 진행한다(카카오·애플과 같게).
   *
   * 네이버 연동 해제는 **토큰 폐기**(`POST /oauth2.0/revoke`, RFC 7009)다. 저장해 둔 갱신 토큰을
   * `token_type_hint=refresh_token`으로 보내면 짝인 접근 토큰도 같이 폐기되고 "연결된 서비스"에서 빠진다.
   * 성공은 **HTTP 200**(본문 없음, 이미 폐기됐거나 없는 토큰도 200)으로 보고, 본문에 error·HTML 오류 화면이 오면 실패로 남긴다.
   * 리다이렉트는 따라가지 않는다. (11-18 검토: 11-16에 옮긴 `grant_type=delete`는 2026-05 네이버 명세에서 빠진 옛 방식이고
   * 가짜 키·가짜 토큰에도 `result: "success"`를 줘 끊겼는지 알 수 없었다. `/revoke`가 가짜 키에 401인 것은 키 확인 실패다)
   */
  async revoke(
    audience: AudienceConst,
    encryptedRefreshToken: string | null | undefined,
  ): Promise<void> {
    if (!encryptedRefreshToken) return;
    if (!this.revokeOnWithdraw) {
      LoggerUtil.log("네이버 연결 끊기 건너뜀: 상용이 아님(같은 네이버 앱을 써서)");
      return;
    }
    let refreshToken: string;
    try {
      refreshToken = this.tokenEncryptionUtil.decrypt(encryptedRefreshToken);
    } catch (error) {
      this.reportFailure("revoke-decrypt", {}, error);
      return;
    }
    // 토큰을 받은 앱의 키로(사장님 앱을 나누면 _SELLER)
    const clientId = audience === AUDIENCE.SELLER ? this.clientIdSeller : this.clientId;
    const clientSecret = audience === AUDIENCE.SELLER ? this.clientSecretSeller : this.clientSecret;
    const requestConfig = {
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      timeout: 3000,
      maxRedirects: 0,
    };
    const reportRevokeFailure = (operation: string, status: number, data: unknown) =>
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "naver",
          module: "auth-naver-oauth",
          operation,
          ...ExternalApiErrorUtil.fromResponseBody(data, status),
        },
        new Error(`naver ${operation} ${status}`),
      );
    try {
      const res = await this.httpClient.post(
        NAVER_REVOKE_URL,
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          token: refreshToken,
          token_type_hint: "refresh_token",
        }),
        requestConfig,
      );
      const body: unknown = res.data;
      const looksLikeError =
        (typeof body === "string" && /<html/i.test(body)) ||
        (typeof body === "object" && body !== null && "error" in body);
      if (res.status === 200 && !looksLikeError) {
        LoggerUtil.log(`네이버 연결 끊기 완료(${audience})`);
        return;
      }
      reportRevokeFailure("revoke", res.status, body);
    } catch (error: any) {
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "naver",
          module: "auth-naver-oauth",
          operation: "revoke",
          ...ExternalApiErrorUtil.fromAxiosError(error ?? {}),
        },
        error,
      );
    }
  }
}
