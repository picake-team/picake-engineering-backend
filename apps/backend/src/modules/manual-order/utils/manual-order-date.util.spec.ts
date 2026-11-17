import { describe, expect, it } from "vitest";
import {
  addDaysToYmd,
  kstDateTimeToUtc,
  ymdDayDiff,
  ymdWeekday,
} from "@apps/backend/modules/manual-order/utils/manual-order-date.util";

describe("manual-order-date.util", () => {
  it("날 수 차이", () => {
    expect(ymdDayDiff("2026-12-01", "2026-12-31")).toBe(30);
    expect(ymdDayDiff("2026-12-31", "2027-01-01")).toBe(1);
    expect(ymdDayDiff("2026-12-02", "2026-12-01")).toBe(-1);
  });

  it("날 더하기(달·해 넘김)", () => {
    expect(addDaysToYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToYmd("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("요일", () => {
    expect(ymdWeekday("2026-12-24")).toBe(4);
    expect(ymdWeekday("2026-11-15")).toBe(0);
  });

  it("한국 시간 → UTC(자정 앞이면 전날)", () => {
    expect(kstDateTimeToUtc("2026-12-24", "12:00").toISOString()).toBe("2026-12-24T03:00:00.000Z");
    expect(kstDateTimeToUtc("2026-12-24", "08:30").toISOString()).toBe("2026-12-23T23:30:00.000Z");
  });
});
