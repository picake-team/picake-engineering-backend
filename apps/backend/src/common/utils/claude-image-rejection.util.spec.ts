import { describe, expect, it } from "vitest";

import { isClaudeImageRejection } from "./claude-image-rejection.util";

describe("isClaudeImageRejection", () => {
  it("400·413만 사진 문제로 보고, 키·권한·모델·크레딧·한도·서버 오류는 우리 쪽으로 본다", () => {
    expect(isClaudeImageRejection({ status: 400, message: "Could not process image" })).toBe(true);
    expect(isClaudeImageRejection({ status: 413, message: "request too large" })).toBe(true);
    for (const status of [401, 403, 404, 429, 500, 529, undefined]) {
      expect(isClaudeImageRejection({ status, message: "x" })).toBe(false);
    }
    expect(
      isClaudeImageRejection({
        status: 400,
        message: "400",
        error: {
          error: { message: "Your credit balance is too low to access the Anthropic API." },
        },
      }),
    ).toBe(false);
    // 설명(explanation) 같은 낱말 안의 plan은 크레딧 글로 보지 않는다
    expect(isClaudeImageRejection({ status: 400, message: "no explanation: bad image" })).toBe(
      true,
    );
  });
});
