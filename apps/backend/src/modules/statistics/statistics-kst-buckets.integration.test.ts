import { describe, expect, it } from "vitest";

import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { loadAdminStatisticsDailyBuckets } from "@apps/backend/modules/statistics/admin/utils/admin-statistics-daily-buckets.util";
import { loadSellerOrderStatisticsTimeBuckets } from "@apps/backend/modules/statistics/seller/utils/seller-order-statistics-time-buckets.util";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 통계의 요일·시간대·날짜는 한국 시각이어야 한다(11-16 검토 — 시간대 없는 칸에 AT TIME ZONE 'Asia/Seoul'을 바로 붙여
 * 12시 주문이 3시·전날로 잡혔다). 로컬 테스트 DB(세션 Asia/Seoul)와 CI(세션 UTC) 둘 다에서 같아야 한다.
 */
describe("통계 한국 시각 버킷", () => {
  // 한국 11-16(월) 하루 = UTC 11-15 15:00 ~ 11-16 14:59:59.999
  const start = new Date("2026-11-15T15:00:00.000Z");
  const end = new Date("2026-11-16T14:59:59.999Z");

  async function seed() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const product = await createTestProduct(prisma, store.id);
    const consumer = await createTestConsumer(prisma);
    const refs = { consumerId: consumer.id, productId: product.id, storeId: store.id };
    const done = { orderStatus: OrderStatus.PICKUP_COMPLETED };
    // 한국 월 12:00 접수 → 토 15:00 픽업
    await createTestOrder(prisma, refs, {
      ...done,
      totalPrice: 30000,
      createdAt: new Date("2026-11-16T03:00:00Z"),
      pickupDate: new Date("2026-11-21T06:00:00Z"),
    });
    // 한국 월 00:30 접수(UTC로는 전날 일요일) → 월 10:00 픽업
    await createTestOrder(prisma, refs, {
      ...done,
      totalPrice: 10000,
      createdAt: new Date("2026-11-15T15:30:00Z"),
      pickupDate: new Date("2026-11-16T01:00:00Z"),
    });
    // 기간 밖: 한국 일 23:30 접수
    await createTestOrder(prisma, refs, {
      ...done,
      totalPrice: 99000,
      createdAt: new Date("2026-11-15T14:30:00Z"),
      pickupDate: new Date("2026-11-16T02:00:00Z"),
    });
    return { prisma, store };
  }

  it("판매자 요일·시간대: 접수·픽업 모두 한국 요일·시각으로 세고, 한국 날짜 밖 주문은 뺀다", async () => {
    const { prisma, store } = await seed();

    const r = await loadSellerOrderStatisticsTimeBuckets(prisma, {
      storeId: store.id,
      start,
      end,
      orderStatuses: [OrderStatus.PICKUP_COMPLETED],
    });

    const hour = (rows: { hour: number; count: number }[], h: number) =>
      rows.find((x) => x.hour === h)?.count ?? 0;
    const day = (rows: { weekday: number; total: number }[], d: number) =>
      rows.find((x) => x.weekday === d)?.total ?? 0;

    expect(hour(r.hourlyOrders, 12)).toBe(1);
    expect(hour(r.hourlyOrders, 0)).toBe(1);
    expect(r.hourlyOrders.reduce((s, x) => s + x.count, 0)).toBe(2);
    expect(day(r.weekdayOrders, 1)).toBe(2); // 월
    expect(day(r.weekdayOrders, 0)).toBe(0); // 일(기간 밖 주문·UTC 날짜로 새지 않음)
    expect(day(r.weekdaySales, 1)).toBe(40000);
    expect(day(r.weekdayPickupOrders, 6)).toBe(1); // 토 픽업
    expect(hour(r.hourlyPickupOrders, 15)).toBe(1);
    expect(hour(r.hourlyPickupOrders, 10)).toBe(1);
  });

  it("관리자 날짜별 추이: 한국 날짜로 묶는다", async () => {
    const { prisma } = await seed();

    const rows = await loadAdminStatisticsDailyBuckets(prisma, {
      startYmd: "2026-11-16",
      endYmd: "2026-11-16",
      start,
      end,
      gmvOrderStatuses: [OrderStatus.PICKUP_COMPLETED],
      metrics: ["orders"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-11-16", orderCount: 2 });
  });
});
