import { describe, expect, it } from "vitest";
import {
  formatArea,
  formatBudget,
  formatCake,
  formatHour,
  formatHourRange,
  formatKstDateTime,
  formatPickup,
} from "@apps/backend/modules/quote-request/utils/quote-request-label.util";

const kst = (s: string) => new Date(`${s}+09:00`);

describe("견적 요청 문구", () => {
  it("시각", () => {
    expect(formatHour(0)).toBe("밤 12시");
    expect(formatHour(9)).toBe("오전 9시");
    expect(formatHour(12)).toBe("낮 12시");
    expect(formatHour(19)).toBe("오후 7시");
    expect(formatHour(23)).toBe("밤 11시");
    expect(formatHour(24)).toBe("밤 12시");
    expect(formatHourRange(14, 17)).toBe("오후 2시~5시");
    expect(formatHourRange(11, 14)).toBe("오전 11시~오후 2시");
    expect(formatKstDateTime(kst("2026-12-23T23:00:00"))).toBe("12월 23일(수) 밤 11시");
  });

  it("픽업 줄", () => {
    const base = { pickupDate: "2026-12-24", pickupHourFrom: null, pickupHourTo: null };
    expect(formatPickup({ ...base, pickupStartAt: kst("2026-12-24T00:00:00") })).toBe(
      "12월 24일(목) 아무 때나",
    );
    expect(
      formatPickup({
        ...base,
        pickupHourFrom: 14,
        pickupHourTo: 17,
        pickupStartAt: kst("2026-12-24T14:00:00"),
      }),
    ).toBe("12월 24일(목) 오후 2시~5시");
    expect(
      formatPickup({
        pickupDate: "2026-11-09",
        pickupHourFrom: null,
        pickupHourTo: null,
        pickupStartAt: kst("2026-11-09T19:00:00"),
      }),
    ).toBe("11월 9일(월) 오후 7시 이후");
  });

  it("케이크 줄", () => {
    expect(
      formatCake({ size: "NO1", quantity: 1, creams: ["FRESH_CREAM"], flavorNote: null }),
    ).toBe("1호 케이크 1개 · 생크림");
    expect(formatCake({ size: "LUNCHBOX", quantity: 10, creams: [], flavorNote: null })).toBe(
      "도시락 케이크 10개",
    );
    expect(
      formatCake({
        size: "MINI",
        quantity: 1,
        creams: ["BUTTER_CREAM", "CREAM_CHEESE"],
        flavorNote: "초코 시트",
      }),
    ).toBe("미니 케이크 1개 · 버터크림·크림치즈·초코 시트");
  });

  it("예산", () => {
    expect(formatBudget({ budgetMin: 30000, budgetMax: 50000, quantity: 1 })).toBe("3만~5만원");
    expect(formatBudget({ budgetMin: 100000, budgetMax: null, quantity: 1 })).toBe("10만원 이상");
    expect(formatBudget({ budgetMin: 30000, budgetMax: 30000, quantity: 1 })).toBe("3만원");
    expect(formatBudget({ budgetMin: 20000, budgetMax: 30000, quantity: 10 })).toBe(
      "1개 2만~3만원",
    );
  });

  it("받을 동네", () => {
    const base = {
      onlyDesignatedStores: false,
      areaName: "연남동",
      areaSido: "서울",
      distanceKm: 3,
    };
    expect(formatArea(base)).toBe("연남동 3km 안");
    expect(formatArea({ ...base, distanceKm: null })).toBe("연남동 · 서울 전체");
    expect(formatArea({ ...base, onlyDesignatedStores: true, areaName: null })).toBe("이 가게에만");
  });
});
