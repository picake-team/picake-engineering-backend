import { describe, expect, it } from "vitest";

import { createdAtRangeFilter } from "./order-list-query.util";

/** 주문일 거르기: YYYY-MM-DD는 한국 달력 하루(서버는 UTC) — 2026-11-12 전체 검토 */
describe("createdAtRangeFilter", () => {
  it("YYYY-MM-DD는 한국 시간 0시~23:59:59.999로 본다", () => {
    const r = createdAtRangeFilter("2026-11-12", "2026-11-12");
    expect(r?.gte?.toISOString()).toBe("2026-11-11T15:00:00.000Z");
    expect(r?.lte?.toISOString()).toBe("2026-11-12T14:59:59.999Z");
  });

  it("한국 시간 오전 8시에 들어온 주문도 그날에 들어간다", () => {
    const r = createdAtRangeFilter("2026-11-12", "2026-11-12")!;
    const at8KST = new Date("2026-11-11T23:00:00.000Z");
    expect(at8KST >= r.gte! && at8KST <= r.lte!).toBe(true);
  });

  it("시각이 붙은 값은 그대로, 둘 다 없으면 거르지 않는다", () => {
    expect(createdAtRangeFilter("2026-11-12T03:00:00.000Z")?.gte?.toISOString()).toBe(
      "2026-11-12T03:00:00.000Z",
    );
    expect(createdAtRangeFilter()).toBeUndefined();
  });
});
