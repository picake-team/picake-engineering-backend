import { describe, expect, it } from "vitest";
import { DailyQuota } from "@apps/backend/common/utils/daily-quota.util";

describe("DailyQuota(하루 한도, 한국 시간)", () => {
  it("한도까지 쓰고, 넘으면 false이고 세지 않는다. 키마다 따로 센다", () => {
    const quota = new DailyQuota(2, () => Date.parse("2026-11-14T10:00:00+09:00"));
    expect(quota.tryConsume("a")).toBe(true);
    expect(quota.tryConsume("a")).toBe(true);
    expect(quota.tryConsume("a")).toBe(false);
    expect(quota.tryConsume("b")).toBe(true);
  });

  it("한국 시간 자정이 지나면 다시 쓸 수 있다(UTC 자정이 아니라)", () => {
    let now = Date.parse("2026-11-14T23:59:00+09:00");
    const quota = new DailyQuota(1, () => now);
    expect(quota.tryConsume("a")).toBe(true);
    // UTC로는 이미 다음 날이 아니다(14:59Z) → 아직 같은 날
    expect(quota.tryConsume("a")).toBe(false);
    now = Date.parse("2026-11-15T00:00:00+09:00");
    expect(quota.tryConsume("a")).toBe(true);
  });

  it("되돌리면 한 번 더 쓸 수 있다", () => {
    const quota = new DailyQuota(1, () => Date.parse("2026-11-14T10:00:00+09:00"));
    expect(quota.tryConsume("a")).toBe(true);
    quota.refund("a");
    expect(quota.tryConsume("a")).toBe(true);
    expect(quota.tryConsume("a")).toBe(false);
  });
});
