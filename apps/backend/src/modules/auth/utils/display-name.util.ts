import { SensitiveDataUtil } from "@apps/backend/common/utils/sensitive-data.util";
/**
 * 표시용 실명 마스킹 (예: 이수은 → 이*은)
 */
export function maskDisplayNameForPrivacy(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  if (!t) return "";
  const chars = Array.from(t);
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  if (chars.length === 3) return `${chars[0]}*${chars[2]}`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/**
 * 이미 가입한 계정 안내에 쓰는 로그인 이메일(가림). 휴대폰 인증을 막 통과한 본인에게만 보인다.
 * 구글 계정이 여러 개인 손님이 "어느 계정으로 가입했는지" 알 수 있게 한다(계정 찾기와 같은 정보).
 */
export function maskLoginEmail(email: string | null | undefined): string | null {
  return email ? SensitiveDataUtil.maskEmail(email) : null;
}
