import { describe, expect, it } from "vitest";
import {
  socialNameToDisplay,
  socialPhoneToLocal,
} from "@apps/backend/modules/auth/utils/social-signup.util";

describe("social-signup.util — 소셜 서비스가 준 이름·번호를 가입표 모양으로", () => {
  describe("socialPhoneToLocal", () => {
    it.each([
      ["+82 10-1234-5678", "01012345678"], // 카카오
      ["+82 010-1234-5678", "01012345678"],
      ["010-1234-5678", "01012345678"], // 네이버
      ["01012345678", "01012345678"],
      ["011-123-4567", "0111234567"],
    ])("%s → %s", (raw, expected) => {
      expect(socialPhoneToLocal(raw)).toBe(expected);
    });

    it.each([["+1 650-555-1234"], ["02-123-4567"], [""], [null], [undefined], [12345678]])(
      "국내 휴대폰이 아니면 없음(%s) — 문자 인증으로 받는다",
      (raw) => {
        expect(socialPhoneToLocal(raw)).toBeUndefined();
      },
    );
  });

  describe("socialNameToDisplay", () => {
    it("앞뒤 공백을 빼고 가운데 공백은 하나로", () => {
      expect(socialNameToDisplay("  홍길동 ")).toBe("홍길동");
      expect(socialNameToDisplay("Gildong   Hong")).toBe("Gildong Hong");
    });

    it("비었거나 50자를 넘거나 글자가 아니면 없음 — 가입 화면은 빈 칸", () => {
      expect(socialNameToDisplay("")).toBeUndefined();
      expect(socialNameToDisplay("   ")).toBeUndefined();
      expect(socialNameToDisplay("가".repeat(51))).toBeUndefined();
      expect(socialNameToDisplay("가".repeat(50))).toBe("가".repeat(50));
      expect(socialNameToDisplay(null)).toBeUndefined();
      expect(socialNameToDisplay({ name: "홍길동" })).toBeUndefined();
    });
  });
});
