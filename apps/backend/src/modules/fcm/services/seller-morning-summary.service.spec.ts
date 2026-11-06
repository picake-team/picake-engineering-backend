import { describe, expect, it } from "vitest";

import {
  buildMorningSummaryCopy,
  formatKstTime,
  kstClock,
} from "@apps/backend/modules/fcm/services/seller-morning-summary.service";

describe("kstClock", () => {
  it("UTC 전날 밤 11시 30분은 한국 날짜로 다음 날 8시다", () => {
    expect(kstClock(new Date("2026-11-05T23:30:00.000Z"))).toEqual({
      dateKey: "2026-11-06",
      hour: 8,
    });
  });

  it("한국 자정 직전과 직후를 맞게 나눈다", () => {
    expect(kstClock(new Date("2026-11-06T14:59:00.000Z"))).toEqual({
      dateKey: "2026-11-06",
      hour: 23,
    });
    expect(kstClock(new Date("2026-11-06T15:00:00.000Z"))).toEqual({
      dateKey: "2026-11-07",
      hour: 0,
    });
  });
});

describe("formatKstTime", () => {
  it("한국 시각을 24시간 hh:mm으로", () => {
    expect(formatKstTime(new Date("2026-11-06T02:00:00.000Z"))).toBe("11:00");
    expect(formatKstTime(new Date("2026-11-06T08:30:00.000Z"))).toBe("17:30");
  });
});

describe("buildMorningSummaryCopy", () => {
  const firstPickupAt = new Date("2026-11-06T02:00:00.000Z");

  it('스토어가 하나면 "오늘 픽업 n건" / "첫 픽업 hh:mm"', () => {
    expect(
      buildMorningSummaryCopy({
        pickupCount: 2,
        firstPickupAt,
        storeName: "달콤케이크",
        sellerStoreCount: 1,
      }),
    ).toEqual({ title: "오늘 픽업 2건", body: "첫 픽업 11:00" });
  });

  it("스토어가 여럿이면 제목 앞에 [스토어 이름]", () => {
    expect(
      buildMorningSummaryCopy({
        pickupCount: 1,
        firstPickupAt,
        storeName: "달콤케이크 2호점",
        sellerStoreCount: 2,
      }).title,
    ).toBe("[달콤케이크 2호점] 오늘 픽업 1건");
  });
});
