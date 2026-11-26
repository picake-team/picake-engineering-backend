import { TermsType } from "@apps/backend/infra/database/prisma/generated/client";
import {
  AUDIENCE,
  AudienceConst,
  KAKAO_SERVICE_TERMS,
} from "@apps/backend/modules/auth/constants/auth.constants";
import {
  socialNameToDisplay,
  socialPhoneToLocal,
} from "@apps/backend/modules/auth/utils/social-signup.util";

/**
 * 카카오 한 번에 가입(카카오싱크, 기획 I-59 B) 도우미.
 * 카카오가 준 값은 로그인 때 서버가 받아 가입표에만 담고, 가입 API는 가입표에서만 꺼내 쓴다.
 */

/**
 * 카카오 사용자 정보의 전화번호("+82 10-1234-5678")를 국내 휴대폰 번호("01012345678")로.
 * 국내 휴대폰 번호가 아니면(해외 번호 등) undefined — 그때는 지금처럼 문자 인증으로 받는다.
 */
export const kakaoPhoneToLocal = socialPhoneToLocal;

/** 카카오 계정 이름 — 가입 화면 이름 칸을 미리 채우는 데만 쓴다(손님이 고칠 수 있음) */
export const kakaoNameToDisplay = socialNameToDisplay;

/**
 * 약관 동의를 "이번 로그인에서 한 동의"로 볼 시간. 카카오 동의 화면 → 로그인 → 가입표까지 몇 초~몇 분이라 넉넉히 30분(가입표 수명과 같게).
 * 이보다 오래된 동의는 쓰지 않는다 — 탈퇴했다 다시 오는 사람(카카오에 예전 동의가 남음)이나 우리 약관 버전이 바뀐 뒤에는
 * 지금 버전에 동의했다고 기록할 수 없어서, 가입 화면에서 약관을 다시 받는다(2026-11-16 검토).
 */
export const KAKAO_TERMS_FRESH_MS = 30 * 60 * 1000;

/**
 * 카카오 "서비스 약관 동의 내역" 응답에서 이번 로그인에서 동의한 약관 태그를 꺼낸다.
 * 응답 모양을 공식 문서에서 다 확인하지 못해(2026-11-16) 알려진 두 모양(`service_terms[].{tag,agreed,agreed_at}`,
 * `allowed_service_terms[].{tag,agreed_at}`)을 받는다. 동의 시각이 없거나 오래됐거나 모르는 모양이면 빼고 —
 * 빈 목록이면 가입 화면이 지금처럼 약관 체크를 받는다.
 */
export function parseKakaoAgreedServiceTerms(data: unknown, nowMs: number = Date.now()): string[] {
  const body = (data ?? {}) as {
    service_terms?: Array<{ tag?: unknown; agreed?: unknown; agreed_at?: unknown }>;
    allowed_service_terms?: Array<{ tag?: unknown; agreed_at?: unknown }>;
  };
  const fresh = (agreedAt: unknown) => {
    if (typeof agreedAt !== "string") return false;
    const t = Date.parse(agreedAt);
    // 기기·서버 시계 차이로 조금 앞선 시각은 받는다(5분)
    return Number.isFinite(t) && t <= nowMs + 5 * 60 * 1000 && nowMs - t <= KAKAO_TERMS_FRESH_MS;
  };
  if (Array.isArray(body.service_terms)) {
    return body.service_terms
      .filter((t) => t && t.agreed === true && typeof t.tag === "string" && fresh(t.agreed_at))
      .map((t) => t.tag as string);
  }
  if (Array.isArray(body.allowed_service_terms)) {
    return body.allowed_service_terms
      .filter((t) => t && typeof t.tag === "string" && fresh(t.agreed_at))
      .map((t) => t.tag as string);
  }
  return [];
}

function termsFor(aud: AudienceConst) {
  return aud === AUDIENCE.SELLER ? KAKAO_SERVICE_TERMS.seller : KAKAO_SERVICE_TERMS.consumer;
}

/** 이 대상(손님/사장님)의 약관 태그만 남긴다 — 한 카카오 앱을 같이 써서 다른 쪽 태그가 섞일 수 있음 */
export function filterKakaoTermsTags(aud: AudienceConst, tags: string[]): string[] {
  const own = new Set<string>(termsFor(aud).map((t) => t.tag));
  return Array.from(new Set(tags.filter((t) => own.has(t))));
}

/**
 * 가입표에 담긴 카카오 약관 동의로 가입할 수 있는지.
 * allRequired: 이 대상의 필수 약관에 모두 동의 → 가입 화면 약관 체크 없이 가입
 * types: 동의한 약관 종류(선택 약관 포함) → 지금 활성 버전으로 동의 이력 기록
 * age14: 카카오에서 "만 14세 이상"(문서 없는 항목, type null)에 동의 → 계정 ageConfirmedAt
 */
export function resolveKakaoAgreedTerms(
  aud: AudienceConst,
  tags: string[] | undefined,
): { allRequired: boolean; types: TermsType[]; age14: boolean } {
  const agreed = new Set(tags ?? []);
  const list = termsFor(aud);
  const allRequired = list.filter((t) => t.required).every((t) => agreed.has(t.tag));
  const types = list
    .filter((t) => agreed.has(t.tag) && t.type !== null)
    .map((t) => t.type as TermsType);
  const age14 = list.some((t) => t.type === null && agreed.has(t.tag));
  return { allRequired, types, age14 };
}
