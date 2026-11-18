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
  /** 운영자 대신 입력 출입증(`type: act_as`)의 세션 id(기획 I-41) */
  sid?: string;
  /**
   * 운영자 대신 입력 중이면 누가 어느 세션으로 들어왔는지(기획 I-41). JWT 전략이 세션 행을 확인한 뒤 붙인다.
   * `sub`는 그대로 판매자 id라 판매자 서비스는 지금처럼 돌고, 운영자 표시·계좌 지킴·지우기 범위만 이 값을 본다.
   */
  actor?: ActAsActor;
}

/** 운영자 대신 입력(기획 I-41) 중인 관리자·세션·가게 */
export interface ActAsActor {
  adminId: string;
  sessionId: string;
  storeId: string;
}

/** 소셜 로그인 종류 */
export type SocialProvider = "google" | "kakao" | "apple" | "naver";

/**
 * 가입표(registerToken) 내용 — 로그인 때 서버가 소셜 서비스에 확인한 값만 담는다. 서명·검증용, HTTP DTO 아님
 */
export interface RegisterTicketPayload {
  aud: AudienceConst;
  provider: SocialProvider;
  providerId: string;
  /** 소셜 계정 이메일. 네이버는 이메일을 받지 않아 빈 문자열 */
  email: string;
  /** 카카오·네이버가 준 국내 휴대폰 번호(숫자만) — 가입 화면에서 그 번호로 가입하면 문자 인증 없이 쓴다(I-59 B) */
  phone?: string;
  /** 소셜 서비스가 준 이름 — 가입 화면 이름 칸 미리 채우기 */
  name?: string;
  /** 카카오 간편가입에서 동의한 약관 태그(이 대상 것만) */
  terms?: string[];
  /**
   * 소셜 갱신 토큰을 우리 키로 암호화한 값(`TokenEncryptionUtil`) — 가입하면 계정에 저장해 탈퇴 때 연결 끊기에 쓴다(네이버).
   * 가입표는 화면이 읽을 수 있지만 이 값은 암호문이라 풀 수 없다.
   */
  providerRefreshToken?: string;
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
    /** 구글 계정 이름(`profile` 범위) — 가입 화면 이름 칸 미리 채우기에만. 없거나 50자를 넘으면 없음 */
    name?: string;
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
 * 네이버 토큰 교환 직후 프로필 조회 결과 — 서비스 내부 전달용, HTTP DTO 아님
 */
export interface NaverUserInfo {
  userInfo: {
    /** 네이버 회원 식별자(앱마다 다름 — 손님·사장님이 앱 하나를 같이 써서 같은 사람이면 같다) */
    naverId: string;
    /** 휴대전화번호 제공 동의를 받았을 때만(국내 휴대폰, 숫자만) */
    phone?: string;
    /** 이름 제공 동의를 받았을 때만 */
    name?: string;
  };
  /** 네이버 갱신 토큰(평문) — 탈퇴 때 연결 끊기용. 계정·가입표에는 암호화해서만 담는다 */
  refreshToken?: string;
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
