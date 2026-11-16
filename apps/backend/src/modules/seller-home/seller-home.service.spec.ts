import { describe, expect, it, vi } from "vitest";

import type { FeedService } from "@apps/backend/modules/feed/feed.service";
import type { NotificationService } from "@apps/backend/modules/notification/services/notification.service";
import { OrderSortBy, OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import type { OrderService } from "@apps/backend/modules/order/order.service";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { SellerHomeService } from "@apps/backend/modules/seller-home/seller-home.service";

/** PC 홈 "오늘 픽업 예정": 취소는 빼고 픽업 가까운 순(휴대폰 홈과 같게, 11-16 검토) */
describe("SellerHomeService 오늘 픽업", () => {
  it("취소된 주문은 빼고, 픽업 가까운 순으로 받아 픽업 시각 순서로 돌려준다", async () => {
    const order = (id: string, orderStatus: string, pickupDate: string) => ({
      id,
      orderStatus,
      pickupDate,
    });
    const getOrdersForSeller = vi.fn(async (q: { pickupStartDate?: string }) => ({
      data: q.pickupStartDate
        ? [
            order("late", OrderStatus.CONFIRMED, "2026-11-16T09:00:00Z"),
            order("canceled", OrderStatus.CANCEL_COMPLETED, "2026-11-16T04:00:00Z"),
            order("early", OrderStatus.PICKUP_PENDING, "2026-11-16T03:00:00Z"),
            order("refund", OrderStatus.CANCEL_REFUND_PENDING, "2026-11-16T05:00:00Z"),
          ]
        : [],
    }));
    const service = new SellerHomeService(
      { getOrdersForSeller } as unknown as OrderService,
      {
        listSellerWebForStore: vi.fn().mockResolvedValue({ items: [] }),
      } as unknown as NotificationService,
      {
        getFeedsByStoreIdForSeller: vi.fn().mockResolvedValue({ data: [] }),
      } as unknown as FeedService,
    );

    const res = await service.getDashboard("store-1", { sub: "seller-1" } as JwtVerifiedPayload);

    expect(res.todayPickups.map((o: { id: string }) => o.id)).toEqual(["early", "late"]);
    const todayQuery = getOrdersForSeller.mock.calls.find(([q]) => q.pickupStartDate)?.[0] as {
      sortBy: string;
    };
    expect(todayQuery.sortBy).toBe(OrderSortBy.PICKUP_ASC);
  });
});
