import { JwtService } from "@nestjs/jwt";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AUTH_ERROR_MESSAGES,
  TOKEN_TYPES,
  JWT_EXPIRATION,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthTokenPairResponseDto } from "@apps/backend/modules/auth/dto/auth-token.dto";
import {
  JwtPayload,
  JwtVerifiedPayload,
  RegisterTicketPayload,
} from "@apps/backend/modules/auth/types/auth.types";
@Injectable()
export class JwtUtil {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 액세스 토큰과 리프레시 토큰을 생성합니다.
   * @param payload JWT 페이로드
   * @returns 토큰 쌍
   */
  async generateTokenPair(payload: JwtPayload): Promise<AuthTokenPairResponseDto> {
    const accessTokenPayload = {
      ...payload,
      type: TOKEN_TYPES.ACCESS,
    };

    const refreshTokenPayload = {
      ...payload,
      type: TOKEN_TYPES.REFRESH,
    };

    // 액세스 토큰과 리프레시 토큰 생성
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessTokenPayload, {
        expiresIn: JWT_EXPIRATION.ACCESS_TOKEN,
      }),
      this.jwtService.signAsync(refreshTokenPayload, {
        expiresIn: JWT_EXPIRATION.REFRESH_TOKEN,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * 액세스 토큰을 생성합니다.
   * @param payload JWT 페이로드
   * @returns 액세스 토큰
   */
  async generateAccessToken(payload: JwtPayload): Promise<string> {
    const accessTokenPayload = {
      ...payload,
      type: TOKEN_TYPES.ACCESS,
    };

    return await this.jwtService.signAsync(accessTokenPayload, {
      expiresIn: JWT_EXPIRATION.ACCESS_TOKEN,
    });
  }

  /**
   * TOTP 2단계 인증 대기 임시 토큰 (5분 유효)
   */
  async generateTotpPendingToken(payload: JwtPayload): Promise<string> {
    return await this.jwtService.signAsync(
      { ...payload, type: TOKEN_TYPES.TOTP_PENDING },
      { expiresIn: "5m" },
    );
  }

  /** 관리자 최초 Google OTP 등록용 임시 토큰(액세스·리프레시 없음) */
  async generateTotpSetupPendingToken(payload: JwtPayload): Promise<string> {
    return await this.jwtService.signAsync(
      { ...payload, type: TOKEN_TYPES.TOTP_SETUP_PENDING },
      { expiresIn: "30m" },
    );
  }

  /**
   * 소셜 회원가입 가입표(30분)를 만듭니다.
   * 로그인 때 서버가 소셜 서비스에 직접 확인한 ID·이메일만 담는다. 가입 API는 이 가입표로만 가입시킨다(화면은 소셜 ID를 보내지 않음).
   * `type=register`라 로그인 출입증으로는 쓸 수 없다(JWT 전략·실시간 알림 연결이 type=access만 받음).
   */
  async generateRegisterTicket(payload: RegisterTicketPayload): Promise<string> {
    return await this.jwtService.signAsync(
      {
        type: TOKEN_TYPES.REGISTER,
        aud: payload.aud,
        provider: payload.provider,
        providerId: payload.providerId,
        email: payload.email,
        ...(payload.phone ? { phone: payload.phone } : {}),
        ...(payload.name ? { name: payload.name } : {}),
        ...(payload.terms && payload.terms.length > 0 ? { terms: payload.terms } : {}),
      },
      { expiresIn: JWT_EXPIRATION.REGISTER_TICKET },
    );
  }

  /**
   * 가입표를 확인하고 그 안의 소셜 ID·이메일을 돌려줍니다.
   * 서명·만료·용도(type)·대상(aud: 손님/사장님)·소셜 종류가 모두 맞아야 한다. 하나라도 어긋나면 400.
   */
  async verifyRegisterTicket(
    token: string,
    expected: Pick<RegisterTicketPayload, "aud" | "provider">,
  ): Promise<Omit<RegisterTicketPayload, "aud" | "provider">> {
    let payload: Partial<RegisterTicketPayload> & { type?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID);
    }
    const { type, aud, provider, providerId, email, phone, name, terms } = payload ?? {};
    if (
      type !== TOKEN_TYPES.REGISTER ||
      aud !== expected.aud ||
      provider !== expected.provider ||
      typeof providerId !== "string" ||
      providerId.length === 0 ||
      typeof email !== "string" ||
      email.length === 0
    ) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID);
    }
    return {
      providerId,
      email,
      // 서버가 서명한 값이라 믿되, 모양이 어긋나면 없는 것으로(가입 화면이 지금처럼 받는다)
      ...(typeof phone === "string" && /^01\d{8,9}$/.test(phone) ? { phone } : {}),
      ...(typeof name === "string" && name.length > 0 && name.length <= 50 ? { name } : {}),
      ...(Array.isArray(terms) && terms.every((t) => typeof t === "string") ? { terms } : {}),
    };
  }

  /**
   * 토큰을 검증하고 페이로드를 반환합니다.
   * @param token JWT 토큰
   * @returns 검증된 페이로드
   */
  async verifyToken(token: string): Promise<JwtVerifiedPayload> {
    return await this.jwtService.verifyAsync(token);
  }
}
