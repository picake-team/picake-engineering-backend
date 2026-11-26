import { describe, expect, it } from "vitest";

import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";

import {
  filterKakaoTermsTags,
  kakaoNameToDisplay,
  kakaoPhoneToLocal,
  parseKakaoAgreedServiceTerms,
  resolveKakaoAgreedTerms,
} from "./kakao-signup.util";

describe("카카오 한 번에 가입 도우미", () => {
  describe("kakaoPhoneToLocal — 카카오 번호를 국내 휴대폰 번호로", () => {
    it.each([
      ["+82 10-1234-5678", "01012345678"],
      ["+82 010-1234-5678", "01012345678"],
      ["+82 11-123-4567", "0111234567"],
      ["010-1234-5678", "01012345678"],
    ])("%s → %s", (raw, expected) => {
      expect(kakaoPhoneToLocal(raw)).toBe(expected);
    });

    it.each([["+1 415-555-0100"], ["+82 2-123-4567"], [""], [undefined], [12345]])(
      "국내 휴대폰이 아니면 없음(%s) — 문자 인증으로 받는다",
      (raw) => {
        expect(kakaoPhoneToLocal(raw)).toBeUndefined();
      },
    );
  });

  it("이름은 앞뒤 공백을 빼고 1~50자만", () => {
    expect(kakaoNameToDisplay(" 홍길동 ")).toBe("홍길동");
    expect(kakaoNameToDisplay("")).toBeUndefined();
    expect(kakaoNameToDisplay("가".repeat(51))).toBeUndefined();
    expect(kakaoNameToDisplay(null)).toBeUndefined();
  });

  describe("parseKakaoAgreedServiceTerms — 이번 로그인에서 한 약관 동의", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const justNow = "2026-11-16T11:59:30Z";

    it("service_terms 모양: 동의한(agreed=true) 태그만", () => {
      expect(
        parseKakaoAgreedServiceTerms(
          {
            id: 1,
            service_terms: [
              { tag: "picake_c_tos", agreed: true, agreed_at: justNow },
              { tag: "picake_c_location", agreed: false },
              { tag: "picake_c_privacy", agreed: true, agreed_at: justNow },
            ],
          },
          now,
        ),
      ).toEqual(["picake_c_tos", "picake_c_privacy"]);
    });

    it("allowed_service_terms 모양: 목록의 태그", () => {
      expect(
        parseKakaoAgreedServiceTerms(
          { allowed_service_terms: [{ tag: "picake_s_tos", agreed_at: justNow }, {}] },
          now,
        ),
      ).toEqual(["picake_s_tos"]);
    });

    it("오래된 동의(탈퇴 뒤 다시 오거나 약관이 바뀐 뒤)·동의 시각이 없는 것은 쓰지 않는다 — 가입 화면에서 다시 받음", () => {
      expect(
        parseKakaoAgreedServiceTerms(
          {
            service_terms: [
              { tag: "picake_c_tos", agreed: true, agreed_at: "2026-10-01T00:00:00Z" },
              { tag: "picake_c_privacy", agreed: true },
              { tag: "picake_c_third_party", agreed: true, agreed_at: "not-a-date" },
            ],
          },
          now,
        ),
      ).toEqual([]);
    });

    it("모르는 모양·오류 응답이면 빈 목록(가입 화면이 지금처럼 약관을 받음)", () => {
      expect(parseKakaoAgreedServiceTerms({ msg: "error", code: -3 })).toEqual([]);
      expect(parseKakaoAgreedServiceTerms(undefined)).toEqual([]);
    });
  });

  it("다른 대상(손님/사장님) 약관 태그는 섞이지 않는다", () => {
    const tags = ["picake_c_tos", "picake_s_tos", "picake_s_privacy", "unknown"];
    expect(filterKakaoTermsTags(AUDIENCE.CONSUMER, tags)).toEqual(["picake_c_tos"]);
    expect(filterKakaoTermsTags(AUDIENCE.SELLER, tags)).toEqual([
      "picake_s_tos",
      "picake_s_privacy",
    ]);
  });

  describe("resolveKakaoAgreedTerms — 약관 체크 없이 가입할 수 있는지", () => {
    it("손님 필수 3개에 모두 동의하면 가입 가능, 선택(위치) 동의도 기록 종류에", () => {
      expect(
        resolveKakaoAgreedTerms(AUDIENCE.CONSUMER, [
          "picake_c_tos",
          "picake_c_privacy",
          "picake_c_third_party",
          "picake_c_location",
        ]),
      ).toEqual({
        allRequired: true,
        types: [
          "CONSUMER_TERMS_OF_SERVICE",
          "CONSUMER_PRIVACY_POLICY",
          "CONSUMER_THIRD_PARTY_CONSENT",
          "CONSUMER_LOCATION_TERMS",
        ],
        age14: false,
      });
    });

    it("필수 하나라도 빠지면 화면에서 약관 체크를 받는다", () => {
      expect(
        resolveKakaoAgreedTerms(AUDIENCE.CONSUMER, ["picake_c_tos", "picake_c_privacy"])
          .allRequired,
      ).toBe(false);
      expect(resolveKakaoAgreedTerms(AUDIENCE.CONSUMER, undefined).allRequired).toBe(false);
    });

    it("사장님은 사장님 약관 2개", () => {
      expect(
        resolveKakaoAgreedTerms(AUDIENCE.SELLER, ["picake_s_tos", "picake_s_privacy"]),
      ).toEqual({
        allRequired: true,
        types: ["SELLER_TERMS_OF_SERVICE", "SELLER_PRIVACY_POLICY"],
        age14: false,
      });
      expect(resolveKakaoAgreedTerms(AUDIENCE.SELLER, ["picake_c_tos"]).allRequired).toBe(false);
    });

    it("만 14세 이상(문서 없는 항목)은 age14로만 알리고 약관 이력 종류에는 넣지 않는다(법무 LG-02)", () => {
      const r = resolveKakaoAgreedTerms(AUDIENCE.CONSUMER, [
        "picake_c_tos",
        "picake_c_privacy",
        "picake_c_third_party",
        "user_age_check",
      ]);
      expect(r.age14).toBe(true);
      expect(r.types).not.toContain(null);
      expect(r.types).toHaveLength(3);
      // 카카오 전용 연령 동의는 태그 하나(user_age_check, 콘솔에서 고정)를 손님·사장님이 같이 쓴다
      expect(resolveKakaoAgreedTerms(AUDIENCE.SELLER, ["user_age_check"]).age14).toBe(true);
      expect(resolveKakaoAgreedTerms(AUDIENCE.SELLER, ["picake_s_tos"]).age14).toBe(false);
    });

    it("1단계: 만 14세 동의가 없어도 필수 약관을 다 동의했으면 가입은 그대로(웹이 다 나간 뒤 필수로)", () => {
      expect(
        resolveKakaoAgreedTerms(AUDIENCE.CONSUMER, [
          "picake_c_tos",
          "picake_c_privacy",
          "picake_c_third_party",
        ]).allRequired,
      ).toBe(true);
    });
  });
});
