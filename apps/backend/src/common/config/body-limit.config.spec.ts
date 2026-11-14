import { describe, expect, it } from "vitest";
import { isLargeJsonBodyRequest } from "@apps/backend/common/config/body-limit.config";

describe("isLargeJsonBodyRequest(큰 JSON을 받는 요청)", () => {
  it("POST /v1/consumer/quote-requests/photo-read 하나만", () => {
    expect(
      isLargeJsonBodyRequest({ method: "POST", path: "/v1/consumer/quote-requests/photo-read" }),
    ).toBe(true);
  });

  it("앞부분만 같은 경로·끝에 / 붙인 경로·다른 메서드·다른 경로는 기본 한도", () => {
    for (const req of [
      { method: "POST", path: "/v1/consumer/quote-requests/photo-read/x" },
      { method: "POST", path: "/v1/consumer/quote-requests/photo-read/" },
      { method: "POST", path: "/v1/consumer/quote-requests/photo-reader" },
      { method: "POST", path: "/v1/consumer/quote-requests" },
      { method: "PUT", path: "/v1/consumer/quote-requests/photo-read" },
      { method: "PATCH", path: "/v1/consumer/quote-requests/photo-read" },
      { method: "GET", path: "/v1/consumer/quote-requests/photo-read" },
    ]) {
      expect(isLargeJsonBodyRequest(req)).toBe(false);
    }
  });
});
