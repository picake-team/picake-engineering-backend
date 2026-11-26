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
  OAUTH_REDIRECT_PATHS,
  PhoneVerificationPurpose,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { KakaoUserInfo } from "@apps/backend/modules/auth/types/auth.types";
import { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import { PhoneUtil } from "@apps/backend/modules/auth/utils/phone.util";
import { phoneTakenConflict } from "@apps/backend/modules/auth/utils/phone-conflict.util";
import {
  KakaoLoginRequestDto,
  KakaoRegisterRequestDto,
} from "@apps/backend/modules/auth/dto/auth-kakao-oauth.dto";
import { buildInitialNickname } from "@apps/backend/modules/auth/utils/register-nickname.util";
import {
  filterKakaoTermsTags,
  kakaoNameToDisplay,
  kakaoPhoneToLocal,
  parseKakaoAgreedServiceTerms,
  resolveKakaoAgreedTerms,
} from "@apps/backend/modules/auth/utils/kakao-signup.util";
import { Prisma, TermsType } from "@apps/backend/infra/database/prisma/generated/client";
import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { TermsService } from "@apps/backend/modules/terms/terms.service";
import { rethrowRegisterUniqueConflict } from "@apps/backend/modules/auth/utils/register-conflict.util";

@Injectable()
export class AuthKakaoOauthService {
  private readonly kakaoClientId: string;
  private readonly kakaoClientSecret: string;
  private readonly kakaoClientIdSeller: string;
  private readonly kakaoClientSecretSeller: string;
  /** 탈퇴 때 카카오 연결 끊기용 앱 어드민 키(없으면 끊지 않음). 사장님 앱이 다른 카카오 앱이면 _SELLER */
  private readonly kakaoAdminKey: string;
  private readonly kakaoAdminKeySeller: string;
  private readonly consumerBase: string;
  private readonly consumerPath: string;
  private readonly sellerBase: string;
  private readonly sellerPath: string;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtUtil: JwtUtil,
    private readonly configService: ConfigService,
    private readonly authPhoneService: AuthPhoneService,
    private readonly termsService: TermsService,
    private readonly opsAlert: OpsAlertService,
  ) {
    this.kakaoClientId = configService.get<string>("KAKAO_CLIENT_ID")!;
    this.kakaoClientSecret = configService.get<string>("KAKAO_CLIENT_SECRET") ?? "";
    this.kakaoClientIdSeller = configService.get<string>("KAKAO_CLIENT_ID_SELLER")!;
    this.kakaoClientSecretSeller = configService.get<string>("KAKAO_CLIENT_SECRET_SELLER") ?? "";
    this.kakaoAdminKey = configService.get<string>("KAKAO_ADMIN_KEY")?.trim() ?? "";
    this.kakaoAdminKeySeller =
      configService.get<string>("KAKAO_ADMIN_KEY_SELLER")?.trim() || this.kakaoAdminKey;
    this.consumerBase = this.configService.get<string>("PUBLIC_USER_DOMAIN")!;
    this.consumerPath = OAUTH_REDIRECT_PATHS.KAKAO;
    this.sellerBase = this.configService.get<string>("PUBLIC_SELLER_DOMAIN")!;
    this.sellerPath = OAUTH_REDIRECT_PATHS.KAKAO;
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        "User-Agent": "Picake-Backend/1.0",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate, br",
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      httpsAgent: new (require("https").Agent)({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000,
        freeSocketTimeout: 30000,
      }),
    });
  }

  async consumerKakaoLoginWithCode(dto: KakaoLoginRequestDto) {
    const kakaoUserInfo = await this.exchangeCodeForToken(
      dto.code,
      `${this.consumerBase}${this.consumerPath.startsWith("/") ? this.consumerPath : `/${this.consumerPath}`}`,
      {
        clientId: this.kakaoClientId,
        clientSecret: this.kakaoClientSecret,
      },
    );
    return this.kakaoLogin(kakaoUserInfo);
  }

  async sellerKakaoLoginWithCode(dto: KakaoLoginRequestDto) {
    const kakaoUserInfo = await this.exchangeCodeForToken(
      dto.code,
      `${this.sellerBase}${this.sellerPath.startsWith("/") ? this.sellerPath : `/${this.sellerPath}`}`,
      {
        clientId: this.kakaoClientIdSeller,
        clientSecret: this.kakaoClientSecretSeller,
      },
    );
    return this.kakaoLoginSeller(kakaoUserInfo);
  }

  private async exchangeCodeForToken(
    code: string,
    redirectUri: string,
    credentials: { clientId: string; clientSecret: string },
  ): Promise<KakaoUserInfo> {
    try {
      const { clientId, clientSecret } = credentials;
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code: decodeURIComponent(code),
      });
      if (clientSecret) {
        params.set("client_secret", clientSecret);
      }

      const tokenResponse = await this.httpClient.post(
        "https://kauth.kakao.com/oauth/token",
        params,
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
      );

      const accessToken = tokenResponse.data?.access_token;
      if (!accessToken) {
        const failure = {
          provider: "kakao",
          module: "auth-kakao-oauth",
          operation: "token-exchange",
          ...ExternalApiErrorUtil.fromResponseBody(tokenResponse.data, tokenResponse.status),
          details: { redirectUri },
        };
        ExternalApiErrorUtil.reportFailure(
          failure,
          ExternalApiErrorUtil.createFailureError(failure, "no_access_token"),
        );
        throw new BadRequestException(AUTH_ERROR_MESSAGES.KAKAO_OAUTH_TOKEN_EXCHANGE_FAILED);
      }

      const userInfoResponse = await this.httpClient.get("https://kapi.kakao.com/v2/user/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const userInfo = userInfoResponse.data;
      const kakaoId = userInfo?.id?.toString();
      const kakaoEmail = userInfo?.kakao_account?.email;
      if (!kakaoId || !kakaoEmail) {
        const failure = {
          provider: "kakao",
          module: "auth-kakao-oauth",
          operation: "userinfo",
          ...ExternalApiErrorUtil.fromResponseBody(userInfo, userInfoResponse.status),
          details: {
            redirectUri,
            hasKakaoId: Boolean(kakaoId),
            hasKakaoEmail: Boolean(kakaoEmail),
          },
        };
        ExternalApiErrorUtil.reportFailure(
          failure,
          ExternalApiErrorUtil.createFailureError(failure, "missing_id_or_email"),
        );
        throw new BadRequestException(AUTH_ERROR_MESSAGES.KAKAO_OAUTH_TOKEN_EXCHANGE_FAILED);
      }

      return {
        userInfo: {
          kakaoId,
          kakaoEmail,
          // 동의항목(전화번호·이름)을 받았을 때만 들어 있다 — 가입이 필요할 때 가입표에 담는다
          phone: kakaoPhoneToLocal(userInfo?.kakao_account?.phone_number),
          name: kakaoNameToDisplay(userInfo?.kakao_account?.name),
        },
        accessToken,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const failure = {
        provider: "kakao",
        module: "auth-kakao-oauth",
        operation: "exchange-code-for-token",
        ...ExternalApiErrorUtil.fromAxiosError(error),
        details: { redirectUri },
      };
      ExternalApiErrorUtil.reportFailure(failure, error);
      throw new BadRequestException(AUTH_ERROR_MESSAGES.KAKAO_OAUTH_TOKEN_EXCHANGE_FAILED);
    }
  }

  /**
   * 가입이 필요할 때(400 PHONE_VERIFICATION_REQUIRED) 화면에 줄 응답.
   * 서버가 카카오에 직접 확인한 ID·이메일을 가입표(registerToken, 30분)에 담는다 — 가입 API는 이 가입표로만 가입시킨다.
   * 소셜 ID·이메일은 응답 본문에 따로 주지 않는다(서명한 가입표 안에만 — 서명이라 화면이 읽을 수는 있지만 고칠 수 없다).
   */
  private async buildRegisterRequiredError(
    aud: AudienceConst,
    kakaoUserInfo: KakaoUserInfo,
  ): Promise<BadRequestException> {
    const { kakaoId, kakaoEmail, phone, name } = kakaoUserInfo.userInfo;
    const terms = filterKakaoTermsTags(
      aud,
      await this.fetchAgreedServiceTerms(kakaoUserInfo.accessToken),
    );
    const registerToken = await this.jwtUtil.generateRegisterTicket({
      aud,
      provider: "kakao",
      providerId: kakaoId,
      email: kakaoEmail,
      phone,
      name,
      terms,
    });
    return new BadRequestException({
      message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
      registerToken,
    });
  }

  /**
   * 카카오 간편가입에서 동의한 약관 태그(카카오싱크가 켜진 앱에서만 있다).
   * 실패하거나 모르는 응답이면 빈 목록 — 가입 화면이 지금처럼 약관 체크를 받으니 가입은 막히지 않는다.
   */
  private async fetchAgreedServiceTerms(accessToken: string | undefined): Promise<string[]> {
    if (!accessToken) return [];
    try {
      const res = await this.httpClient.get("https://kapi.kakao.com/v2/user/service_terms", {
        headers: { Authorization: `Bearer ${accessToken}` },
        // 새 손님 로그인을 오래 붙잡지 않는다(실패하면 가입 화면에서 약관을 받으면 된다)
        timeout: 3000,
      });
      if (res.status === 200) return parseKakaoAgreedServiceTerms(res.data);
      this.reportServiceTermsFailure(new Error(`kakao service_terms ${res.status}`), res.status);
      return [];
    } catch (error) {
      this.reportServiceTermsFailure(error);
      return [];
    }
  }

  /**
   * 탈퇴할 때 카카오 연결을 끊는다(카카오 권장 — 회원 탈퇴 시 연결 끊기).
   * 끊으면 카카오에 남은 동의(이름·번호, 간편가입 약관, 채널 추가)도 없어져, 다시 가입할 때 동의 화면부터 새로 본다.
   * 우리는 카카오 접근 토큰을 저장하지 않아 앱 어드민 키로 끊는다. 키가 없거나 실패해도 탈퇴는 그대로 진행한다(애플 revoke와 같게).
   */
  async unlink(audience: AudienceConst, kakaoId: string): Promise<void> {
    const adminKey = audience === AUDIENCE.SELLER ? this.kakaoAdminKeySeller : this.kakaoAdminKey;
    if (!adminKey || !kakaoId) return;
    try {
      const res = await this.httpClient.post(
        "https://kapi.kakao.com/v1/user/unlink",
        new URLSearchParams({ target_id_type: "user_id", target_id: kakaoId }),
        {
          headers: {
            Authorization: `KakaoAK ${adminKey}`,
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          },
          timeout: 3000,
        },
      );
      if (res.status === 200) return;
      // -101: 이미 연결이 끊긴 사용자(카카오에서 먼저 끊음) — 끊긴 상태라 괜찮다
      if ((res.data as { code?: number } | undefined)?.code === -101) return;
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "kakao",
          module: "auth-kakao-oauth",
          operation: "unlink",
          ...ExternalApiErrorUtil.fromResponseBody(res.data, res.status),
          details: { audience },
        },
        new Error(`kakao unlink ${res.status}`),
      );
    } catch (error: any) {
      ExternalApiErrorUtil.reportFailure(
        {
          provider: "kakao",
          module: "auth-kakao-oauth",
          operation: "unlink",
          ...ExternalApiErrorUtil.fromAxiosError(error ?? {}),
          details: { audience },
        },
        error,
      );
    }
  }

  /** 간편가입 설정이 어긋나면 조용히 약관 체크로 돌아가므로, 하루 한 번만 알린다 */
  private reportServiceTermsFailure(error: unknown, status?: number) {
    SentryUtil.captureExceptionThrottled(
      "kakao-service-terms",
      24 * 60 * 60 * 1000,
      error,
      "warning",
      { module: "auth-kakao-oauth", operation: "service-terms" },
      { status },
    );
  }

  /** 가입 때 쓸 휴대폰 번호 — "맞아요"면 가입표의 카카오 번호(문자 인증 없음), 아니면 화면이 보낸 번호(문자 인증 필요) */
  private resolveRegisterPhone(dto: KakaoRegisterRequestDto, ticket: { phone?: string }): string {
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

  /** 카카오에서 동의한 약관 종류의 지금 활성 버전 — 동의 이력으로 남긴다 */
  private async activeTermsDocumentIds(
    tx: Prisma.TransactionClient,
    types: TermsType[],
  ): Promise<string[]> {
    if (types.length === 0) return [];
    const docs = await tx.termsDocument.findMany({
      where: { type: { in: types }, isActive: true },
      select: { id: true },
    });
    return docs.map((d) => d.id);
  }

  private async kakaoLogin(kakaoUserInfo: KakaoUserInfo) {
    const {
      userInfo: { kakaoId },
    } = kakaoUserInfo;

    const consumer = await this.prisma.consumer.findUnique({
      where: { kakaoId },
    });

    if (!consumer) {
      throw await this.buildRegisterRequiredError(AUDIENCE.CONSUMER, kakaoUserInfo);
    }

    // 관리자 비활성 계정은 로그인·재가입 모두 불가 (계정·데이터 유지)
    if (!consumer.isActive) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }

    if (!consumer.phone || !consumer.isPhoneVerified) {
      throw await this.buildRegisterRequiredError(AUDIENCE.CONSUMER, kakaoUserInfo);
    }
    return await this.prisma.$transaction(async (tx) => {
      const tokenPair = await this.jwtUtil.generateTokenPair({
        sub: consumer.id,
        aud: AUDIENCE.CONSUMER,
      });
      await tx.consumer.update({
        where: { id: consumer.id },
        data: { lastLoginAt: new Date() },
      });
      return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
    });
  }

  private async kakaoLoginSeller(kakaoUserInfo: KakaoUserInfo) {
    const {
      userInfo: { kakaoId },
    } = kakaoUserInfo;

    if (!kakaoId) {
      throw new BadRequestException({
        message: AUTH_ERROR_MESSAGES.KAKAO_OAUTH_TOKEN_EXCHANGE_FAILED,
      });
    }

    const seller = await this.prisma.seller.findUnique({
      where: { kakaoId },
    });

    if (!seller) {
      throw await this.buildRegisterRequiredError(AUDIENCE.SELLER, kakaoUserInfo);
    }

    // 관리자 비활성 계정은 로그인·재가입 모두 불가 (계정·데이터 유지)
    if (!seller.isActive) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }

    if (!seller.phone || !seller.isPhoneVerified) {
      throw await this.buildRegisterRequiredError(AUDIENCE.SELLER, kakaoUserInfo);
    }
    return await this.prisma.$transaction(async (tx) => {
      const tokenPair = await this.jwtUtil.generateTokenPair({
        sub: seller.id,
        aud: AUDIENCE.SELLER,
      });
      await tx.seller.update({
        where: { id: seller.id },
        data: { lastLoginAt: new Date() },
      });
      return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
    });
  }

  async consumerKakaoRegisterWithPhone(kakaoRegisterDto: KakaoRegisterRequestDto) {
    const { name, agreedToTerms, agreedToPrivacy, agreedToThirdParty, agreedToAge14 } =
      kakaoRegisterDto;
    const ticket = await this.jwtUtil.verifyRegisterTicket(kakaoRegisterDto.registerToken, {
      aud: AUDIENCE.CONSUMER,
      provider: "kakao",
    });
    const { providerId: kakaoId, email: kakaoEmail } = ticket;
    const trimmedName = name.trim();
    // 카카오가 준 번호를 "맞아요"로 확인했으면 그 번호(문자 인증 없음), 아니면 문자로 인증한 번호
    const normalizedPhone = this.resolveRegisterPhone(kakaoRegisterDto, ticket);
    // 카카오 간편가입에서 필수 약관에 모두 동의했으면 그 동의를 쓴다(화면 약관 체크 없이)
    const kakaoTerms = resolveKakaoAgreedTerms(AUDIENCE.CONSUMER, ticket.terms);

    // 1. 필수 약관 동의 여부 검증
    if (!kakaoTerms.allRequired && (!agreedToTerms || !agreedToPrivacy || !agreedToThirdParty)) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
    }

    const existing = await this.prisma.consumer.findUnique({ where: { kakaoId } });
    if (existing) {
      if (!existing.isActive) {
        throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
      }
      throw new ConflictException(AUTH_ERROR_MESSAGES.KAKAO_ID_ALREADY_EXISTS);
    }

    const isPhoneVerified =
      kakaoRegisterDto.useTicketPhone === true ||
      (await this.authPhoneService.checkPhoneVerificationStatus(
        normalizedPhone,
        AUDIENCE.CONSUMER,
        PhoneVerificationPurpose.KAKAO_REGISTRATION,
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

    // 이 번호로 이미 가입한 계정이 있으면 그 로그인 수단을 알린다(이름·번호·이메일은 가려서). 소셜 연결이 없는 계정이면 PHONE_ALREADY_EXISTS
    const phoneConflict = phoneTakenConflict(existingPhone, ["kakao", "google", "apple", "naver"]);
    if (phoneConflict) {
      throw phoneConflict;
    }

    return await this.prisma
      .$transaction(async (tx) => {
        const now = new Date();
        const row = await tx.consumer.create({
          data: {
            kakaoId,
            kakaoEmail,
            phone: normalizedPhone,
            name: trimmedName,
            nickname: buildInitialNickname(),
            isPhoneVerified: true,
            ageConfirmedAt: agreedToAge14 === true || kakaoTerms.age14 ? new Date() : null,
            lastLoginAt: now,
          },
        });

        // 약관 버전 동의 이력 기록
        await this.termsService.recordConsumerAgreementsInTransaction(
          tx,
          row.id,
          kakaoTerms.allRequired
            ? await this.activeTermsDocumentIds(tx, kakaoTerms.types)
            : (kakaoRegisterDto.termsDocumentIds ?? []),
        );

        const tokenPair = await this.jwtUtil.generateTokenPair({
          sub: row.id,
          aud: AUDIENCE.CONSUMER,
        });
        return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
      })
      .catch((e: unknown) =>
        rethrowRegisterUniqueConflict(e, AUTH_ERROR_MESSAGES.KAKAO_ID_ALREADY_EXISTS),
      );
  }

  async sellerKakaoRegisterWithPhone(kakaoRegisterDto: KakaoRegisterRequestDto) {
    const { name, agreedToTerms, agreedToPrivacy, agreedToAge14 } = kakaoRegisterDto;
    const ticket = await this.jwtUtil.verifyRegisterTicket(kakaoRegisterDto.registerToken, {
      aud: AUDIENCE.SELLER,
      provider: "kakao",
    });
    const { providerId: kakaoId, email: kakaoEmail } = ticket;
    const trimmedName = name.trim();
    // 카카오가 준 번호를 "맞아요"로 확인했으면 그 번호(문자 인증 없음), 아니면 문자로 인증한 번호
    const normalizedPhone = this.resolveRegisterPhone(kakaoRegisterDto, ticket);
    // 카카오 간편가입에서 필수 약관에 모두 동의했으면 그 동의를 쓴다(화면 약관 체크 없이)
    const kakaoTerms = resolveKakaoAgreedTerms(AUDIENCE.SELLER, ticket.terms);

    // 1. 필수 약관 동의 여부 검증
    if (!kakaoTerms.allRequired && (!agreedToTerms || !agreedToPrivacy)) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.REQUIRED_TERMS_NOT_AGREED);
    }

    const existing = await this.prisma.seller.findUnique({ where: { kakaoId } });
    if (existing) {
      if (!existing.isActive) {
        throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
      }
      throw new ConflictException(AUTH_ERROR_MESSAGES.KAKAO_ID_ALREADY_EXISTS);
    }

    const isPhoneVerified =
      kakaoRegisterDto.useTicketPhone === true ||
      (await this.authPhoneService.checkPhoneVerificationStatus(
        normalizedPhone,
        AUDIENCE.SELLER,
        PhoneVerificationPurpose.KAKAO_REGISTRATION,
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

    // 이 번호로 이미 가입한 계정이 있으면 그 로그인 수단을 알린다(이름·번호·이메일은 가려서). 소셜 연결이 없는 계정이면 PHONE_ALREADY_EXISTS
    const phoneConflict = phoneTakenConflict(existingPhone, ["kakao", "google", "naver"]);
    if (phoneConflict) {
      throw phoneConflict;
    }

    const result = await this.prisma
      .$transaction(async (tx) => {
        const now = new Date();
        const row = await tx.seller.create({
          data: {
            kakaoId,
            kakaoEmail,
            phone: normalizedPhone,
            name: trimmedName,
            nickname: buildInitialNickname(),
            isPhoneVerified: true,
            ageConfirmedAt: agreedToAge14 === true || kakaoTerms.age14 ? new Date() : null,
            lastLoginAt: now,
            sellerVerificationStatus: "REGISTERED",
          },
        });

        // 약관 버전 동의 이력 기록
        await this.termsService.recordSellerAgreementsInTransaction(
          tx,
          row.id,
          kakaoTerms.allRequired
            ? await this.activeTermsDocumentIds(tx, kakaoTerms.types)
            : (kakaoRegisterDto.termsDocumentIds ?? []),
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
        rethrowRegisterUniqueConflict(e, AUTH_ERROR_MESSAGES.KAKAO_ID_ALREADY_EXISTS),
      );

    // 새 사장님 가입을 운영자에게 바로 알린다(기획 I-56). 실패해도 가입은 그대로
    void this.opsAlert.notifyNewSeller({
      id: result.sellerId,
      method: "KAKAO",
      createdAt: result.createdAt,
    });
    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }
}
