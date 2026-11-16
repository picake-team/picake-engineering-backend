import type { AudienceConst } from "@apps/backend/modules/auth/constants/auth.constants";

/**
 * 인증 관련 타입 정의
 */

/**
 * JWT 페이로드 (액세스·리프레시 공통 최소 필드) — 서명·검증용, HTTP 요청 DTO 아님
 */
export interface JwtPayload {
  sub: string;
  /** JWT `aud` 클레임 — `AUDIENCE` 상수 값과 동일한 리터럴 유니온(`AudienceConst`) */
  aud: AudienceConst;
}

/**
 * JWT 디코드·검증 결과 — 가드·전략 내부용, HTTP DTO 아님
 */
export interface JwtVerifiedPayload extends JwtPayload {
  type?: string;
  iat?: number;
  exp?: number;
}

/** 소셜 로그인 종류 */
export type SocialProvider = "google" | "kakao" | "apple";

/**
 * 가입표(registerToken) 내용 — 로그인 때 서버가 소셜 서비스에 확인한 값만 담는다. 서명·검증용, HTTP DTO 아님
 */
export interface RegisterTicketPayload {
  aud: AudienceConst;
  provider: SocialProvider;
  providerId: string;
  email: string;
  /** 카카오가 준 국내 휴대폰 번호(숫자만) — 가입 화면에서 "맞아요"로 확인받으면 문자 인증 없이 쓴다(I-59 B) */
  phone?: string;
  /** 소셜 서비스가 준 이름 — 가입 화면 이름 칸 미리 채우기 */
  name?: string;
  /** 카카오 간편가입에서 동의한 약관 태그(이 대상 것만) */
  terms?: string[];
}

/**
 * Passport JWT 검증 후 `req.user` — 전략에서 DB 조회로 보강한 형태, HTTP DTO 아님
 */
export interface AuthenticatedUser extends JwtVerifiedPayload {
  id: string;
  aud: AudienceConst;
  phone?: string;
  loginType?: SocialProvider;
  loginId?: string;
  /** aud === "seller" 일 때만 */
  sellerVerificationStatus?: "REGISTERED" | "BUSINESS_VERIFIED";
  /** aud === "admin" 일 때만 */
  username?: string;
  /** true: 사람 로그인(JWT)이 아니라 관리자 API 키로 인증된 요청 — API 키 자체의 발급/폐기 등 사람 전용 작업에서 차단하는 데 사용 */
  isApiKey?: boolean;
}

/**
 * 구글 토큰 교환 직후 userinfo 조회 결과 — 서비스 내부 전달용, HTTP DTO 아님
 */
export interface GoogleUserInfo {
  userInfo: {
    googleId: string;
    googleEmail: string;
  };
}

/**
 * 카카오 토큰 교환 직후 userinfo 조회 결과 — 서비스 내부 전달용, HTTP DTO 아님
 */
export interface KakaoUserInfo {
  userInfo: {
    kakaoId: string;
    kakaoEmail: string;
    /** 전화번호 동의항목을 받았을 때만(국내 휴대폰, 숫자만) */
    phone?: string;
    /** 이름 동의항목을 받았을 때만 */
    name?: string;
  };
  /** 카카오 액세스 토큰 — 가입이 필요할 때 간편가입 약관 동의 내역을 묻는 데만 쓰고 저장하지 않는다 */
  accessToken?: string;
}

/**
 * 애플 토큰 교환 직후 id_token 검증 결과 — 서비스 내부 전달용, HTTP DTO 아님.
 * `refreshToken`은 탈퇴 시 `/auth/revoke` 호출용으로 암호화해 저장합니다.
 */
export interface AppleUserInfo {
  userInfo: {
    appleId: string;
    appleEmail: string;
  };
  refreshToken: string;
}

/** 애플 id_token(JWT) 검증 후 얻는 클레임 중 사용하는 것만 — Google/Kakao의 userinfo 응답에 대응 */
export interface AppleIdTokenPayload {
  sub: string;
  email?: string;
  aud: string;
  iss: string;
}
