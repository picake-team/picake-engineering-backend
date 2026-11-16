/**
 * 소셜 서비스가 준 이름·전화번호를 가입표에 담을 모양으로 맞추는 도우미(카카오·네이버·구글 공용).
 * 소셜 서비스가 준 값은 로그인 때 서버가 받아 가입표에만 담고, 가입 API는 가입표에서만 꺼내 쓴다.
 */

/**
 * 소셜 계정 이름 — 가입 화면 이름 칸을 미리 채우는 데만 쓴다(손님·사장님이 고칠 수 있음).
 * 비었거나 50자를 넘으면 undefined(가입 화면 이름 칸 규칙과 같게) — 그때는 지금처럼 빈 칸.
 */
export function socialNameToDisplay(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 50 ? name : undefined;
}

/**
 * 소셜 계정 전화번호("+82 10-1234-5678", "010-1234-5678")를 국내 휴대폰 번호("01012345678")로.
 * 국내 휴대폰 번호가 아니면(해외 번호 등) undefined — 그때는 지금처럼 문자 인증으로 받는다.
 */
export function socialPhoneToLocal(raw: unknown): string | undefined {
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
