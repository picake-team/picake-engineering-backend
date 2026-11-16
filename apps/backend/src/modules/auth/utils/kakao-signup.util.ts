import { TermsType } from "@apps/backend/infra/database/prisma/generated/client";
import {
  AUDIENCE,
  AudienceConst,
  KAKAO_SERVICE_TERMS,
} from "@apps/backend/modules/auth/constants/auth.constants";

/**
 * 카카오 한 번에 가입(카카오싱크, 기획 I-59 B) 도우미.
 * 카카오가 준 값은 로그인 때 서버가 받아 가입표에만 담고, 가입 API는 가입표에서만 꺼내 쓴다.
 */

/**
 * 카카오 사용자 정보의 전화번호("+82 10-1234-5678")를 국내 휴대폰 번호("01012345678")로.
 * 국내 휴대폰 번호가 아니면(해외 번호 등) undefined — 그때는 지금처럼 문자 인증으로 받는다.
 */
export function kakaoPhoneToLocal(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  let digits: string;
  if (trimmed.startsWith("+82")) {
    digits = `0${trimmed.slice(3).replace(/\D/g, "").replace(/^0/, "")}`;
  } else if (trimmed.startsWith("+")) {
    return undefined;
  } else {
    digits = trimmed.replace(/\D/g, "");
  }
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : undefined;
}

/** 카카오 계정 이름 — 가입 화면 이름 칸을 미리 채우는 데만 쓴다(손님이 고칠 수 있음) */
export function kakaoNameToDisplay(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name.length > 0 && name.length <= 50 ? name : undefined;
}

/**
 * 카카오 "서비스 약관 동의 내역" 응답에서 동의한 약관 태그를 꺼낸다.
 * 응답 모양을 공식 문서에서 다 확인하지 못해(2026-11-16) 알려진 두 모양을 모두 받고, 모르는 모양이면 빈 목록 —
 * 빈 목록이면 가입 화면이 지금처럼 약관 체크를 받는다.
 */
export function parseKakaoAgreedServiceTerms(data: unknown): string[] {
  const body = (data ?? {}) as {
    service_terms?: Array<{ tag?: unknown; agreed?: unknown }>;
    allowed_service_terms?: Array<{ tag?: unknown }>;
  };
  if (Array.isArray(body.service_terms)) {
    return body.service_terms
      .filter((t) => t && t.agreed === true && typeof t.tag === "string")
      .map((t) => t.tag as string);
  }
  if (Array.isArray(body.allowed_service_terms)) {
    return body.allowed_service_terms
      .filter((t) => t && typeof t.tag === "string")
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
 */
export function resolveKakaoAgreedTerms(
  aud: AudienceConst,
  tags: string[] | undefined,
): { allRequired: boolean; types: TermsType[] } {
  const agreed = new Set(tags ?? []);
  const list = termsFor(aud);
  const allRequired = list.filter((t) => t.required).every((t) => agreed.has(t.tag));
  const types = list.filter((t) => agreed.has(t.tag)).map((t) => t.type as TermsType);
  return { allRequired, types };
}
