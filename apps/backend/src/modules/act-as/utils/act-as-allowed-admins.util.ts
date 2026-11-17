/** 쉼표 목록 환경값(`ADMIN_ACT_AS_USERNAMES`) → 아이디 목록(빈 칸 무시). 비어 있으면 아무도 못 들어간다 */
export function parseActAsAllowedAdmins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
