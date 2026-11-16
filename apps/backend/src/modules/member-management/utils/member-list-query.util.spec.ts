import { describe, expect, it } from "vitest";

import { buildMemberSearchWhere } from "@apps/backend/modules/member-management/utils/member-list-query.util";

describe("관리자 회원 검색 — 번호의 하이픈·띄어쓰기는 빼고 찾는다(11-16 검토)", () => {
  const phoneOf = (search: string) =>
    (buildMemberSearchWhere(search) as { OR: { phone?: { contains: string } }[] }).OR.find(
      (c) => c.phone,
    )?.phone?.contains;

  it("010-1234-5678 → 01012345678", () => {
    expect(phoneOf("010-1234-5678")).toBe("01012345678");
    expect(phoneOf(" 010 1234 5678 ")).toBe("01012345678");
  });

  it("이름 검색은 그대로", () => {
    expect(phoneOf("김철수")).toBe("김철수");
    expect(buildMemberSearchWhere("  ")).toEqual({});
  });
});
