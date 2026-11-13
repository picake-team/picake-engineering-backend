import { afterEach, describe, expect, it, vi } from "vitest";

import { IsValidStartDateConstraint } from "./validators.decorator";

describe("IsValidStartDateConstraint (개업일)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("한국 자정~아침 9시에도 오늘 개업일은 미래 날짜가 아니다(서버는 UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T16:30:00.000Z")); // 11-13 01:30 KST
    const c = new IsValidStartDateConstraint();
    expect(c.validate("20261113")).toBe(true);
    expect(c.validate("20261114")).toBe(false);
    expect(c.defaultMessage()).toContain("오늘 이후");
  });

  it("형식·없는 날짜는 막는다", () => {
    const c = new IsValidStartDateConstraint();
    expect(c.validate("2026111")).toBe(false);
    expect(c.validate("20260230")).toBe(false);
  });
});
