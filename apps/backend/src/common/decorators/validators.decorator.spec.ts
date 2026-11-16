import { describe, expect, it } from "vitest";

import { IsValidKoreanPhoneConstraint } from "@apps/backend/common/decorators/validators.decorator";

describe("IsValidKoreanPhone — 010은 11자리만(11-16 검토)", () => {
  const v = new IsValidKoreanPhoneConstraint();

  it("010 11자리(하이픈·공백 허용), 옛 번호 011·016~019 10·11자리는 통과", () => {
    expect(v.validate("01012345678")).toBe(true);
    expect(v.validate("010-1234-5678")).toBe(true);
    expect(v.validate("011-123-4567")).toBe(true);
    expect(v.validate("01912345678")).toBe(true);
  });

  it("한 자리 빠진 010 번호·휴대폰이 아닌 앞자리·빈 값은 거절", () => {
    expect(v.validate("010-1234-567")).toBe(false);
    expect(v.validate("0121234567")).toBe(false);
    expect(v.validate("")).toBe(false);
  });
});
