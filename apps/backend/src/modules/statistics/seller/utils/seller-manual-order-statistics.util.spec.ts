import { describe, expect, it } from "vitest";
import { ManualOrderSource } from "@apps/backend/infra/database/prisma/generated/client";
import { buildManualOrderStatistics } from "@apps/backend/modules/statistics/seller/utils/seller-manual-order-statistics.util";

describe("buildManualOrderStatistics(직접 적은 주문 통계, 기획 I-42)", () => {
  const result = buildManualOrderStatistics([
    // 2026-12-24 목요일
    {
      pickupDate: "2026-12-24",
      pickupTime: "12:00",
      price: 45000,
      source: ManualOrderSource.KAKAO,
    },
    { pickupDate: "2026-12-24", pickupTime: null, price: 35000, source: ManualOrderSource.KAKAO },
    // 금액을 적지 않은 주문은 수에만
    { pickupDate: "2026-12-25", pickupTime: "13:30", price: null, source: ManualOrderSource.PHONE },
  ]);

  it("매출은 금액을 적은 주문만, 주문 수는 모두", () => {
    expect(result.totalSales).toBe(80000);
    expect(result.totalOrders).toBe(3);
  });

  it("받은 곳은 주문이 있는 곳만", () => {
    expect(result.bySource).toEqual([
      { source: ManualOrderSource.KAKAO, sales: 80000, orders: 2 },
      { source: ManualOrderSource.PHONE, sales: 0, orders: 1 },
    ]);
  });

  it("요일은 월→일 순 7칸, 픽업 날 기준", () => {
    expect(result.weekdayPickupOrders.map((r) => r.label)).toEqual([
      "월요일",
      "화요일",
      "수요일",
      "목요일",
      "금요일",
      "토요일",
      "일요일",
    ]);
    expect(result.weekdayPickupOrders.find((r) => r.weekday === 4)?.total).toBe(2);
    expect(result.weekdayPickupSales.find((r) => r.weekday === 4)?.total).toBe(80000);
    expect(result.weekdayPickupOrders.find((r) => r.weekday === 5)?.total).toBe(1);
  });

  it("시간대는 시각을 적은 주문만", () => {
    expect(result.hourlyPickupOrders).toHaveLength(24);
    expect(result.hourlyPickupOrders[12].count).toBe(1);
    expect(result.hourlyPickupOrders[13].count).toBe(1);
    expect(result.hourlyPickupOrders.reduce((s, h) => s + h.count, 0)).toBe(2);
  });
});
