import { describe, expect, it } from "vitest";
import {
  buildSellerAppleCallbackUrl,
  extractAppleDisplayName,
} from "@apps/backend/modules/auth/utils/apple-signin.util";

describe("애플 form_post → 판매자 웹 콜백", () => {
  const base = "https://seller.picakes.com";

  it("이름은 성+이름(처음 인가 때만 옴), 없거나 모양이 다르면 null", () => {
    expect(
      extractAppleDisplayName(JSON.stringify({ name: { firstName: "길동", lastName: "홍" } })),
    ).toBe("홍길동");
    expect(extractAppleDisplayName(JSON.stringify({ email: "a@b.c" }))).toBeNull();
    expect(extractAppleDisplayName("{not json")).toBeNull();
    expect(extractAppleDisplayName(undefined)).toBeNull();
    expect(extractAppleDisplayName(JSON.stringify({ name: { firstName: 3 } }))).toBeNull();
  });

  it("code가 있으면 code·state(+이름)만 넘기고 id_token 등 나머지는 버린다", () => {
    const url = new URL(
      buildSellerAppleCallbackUrl(base, {
        code: "c.0.x",
        state: "a".repeat(32),
        id_token: "secret",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe("https://seller.picakes.com/auth/login/apple");
    expect(url.searchParams.get("code")).toBe("c.0.x");
    expect(url.searchParams.get("state")).toBe("a".repeat(32));
    expect(url.searchParams.has("id_token")).toBe(false);
    expect(url.searchParams.has("appleName")).toBe(false);
  });

  it("취소하면 error만 넘긴다(판매자 웹은 code가 없으면 로그인 화면으로)", () => {
    const url = new URL(buildSellerAppleCallbackUrl(base, { error: "user_cancelled_authorize" }));
    expect(url.searchParams.get("error")).toBe("user_cancelled_authorize");
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("본문이 비었거나 값이 너무 길어도 던지지 않고 error로 돌려보낸다", () => {
    expect(new URL(buildSellerAppleCallbackUrl(base, undefined)).searchParams.get("error")).toBe(
      "invalid_request",
    );
    const long = new URL(buildSellerAppleCallbackUrl(base, { code: "x".repeat(5000) }));
    expect(long.searchParams.has("code")).toBe(false);
  });

  it("돌아갈 곳은 서버 설정 주소 — 본문 값으로 다른 사이트로 보낼 수 없다", () => {
    const url = new URL(
      buildSellerAppleCallbackUrl(base, { code: "c", state: "https://evil.example/" }),
    );
    expect(url.origin).toBe("https://seller.picakes.com");
  });
});
