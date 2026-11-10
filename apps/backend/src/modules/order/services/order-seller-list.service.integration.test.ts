import { describe, expect, it, vi } from "vitest";

import {
  OrderSortBy,
  OrderStatus,
  OrderType,
} from "@apps/backend/modules/order/constants/order.constants";
import { OrderAutomationService } from "@apps/backend/modules/order/services/order-automation.service";
import type { OrderLifecycleHookService } from "@apps/backend/modules/order/services/order-lifecycle-hook.service";
import { OrderSellerListService } from "@apps/backend/modules/order/services/order-seller-list.service";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";
import { createNotificationOrderDispatchNoopMock } from "@apps/backend/test/mocks";

/**
 * 판매자 앱 주문 탭에서 쓰는 목록 조건을 실제 Postgres로 확인한다.
 * - 지난 주문 탭: type=FINISHED + 픽업 최근 순(끝난 네 상태만, 픽업 일시 내림차순)
 * - 처리할 것·진행 중 칸: 상태 하나 + 픽업 가까운 순(픽업 일시 없는 주문은 맨 뒤)
 */
describe("판매자 주문 목록 정렬·지난 주문 거르기 (integration)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const at = (days: number) => new Date(Date.now() + days * DAY);

  async function setup() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const product = await createTestProduct(prisma, store.id);
    const consumer = await createTestConsumer(prisma);
    const refs = { consumerId: consumer.id, productId: product.id, storeId: store.id };
    const lifecycleHook = {
      afterOrderStatusTransition: vi.fn(),
    } as unknown as OrderLifecycleHookService;
    const automation = new OrderAutomationService(
      prisma,
      lifecycleHook,
      createNotificationOrderDispatchNoopMock(),
    );
    const service = new OrderSellerListService(prisma, automation);
    const user = { sub: seller.id } as JwtVerifiedPayload;
    return { prisma, refs, store, service, user };
  }

  it("FINISHED는 끝난 주문만 픽업 최근 순으로 주고, 픽업 시각이 지났지만 처리 안 한 주문은 뺀다", async () => {
    const { prisma, refs, store, service, user } = await setup();
    const completedOld = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.PICKUP_COMPLETED,
      pickupDate: at(-5),
    });
    const noShow = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.NO_SHOW,
      pickupDate: at(-2),
    });
    const canceled = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.CANCEL_COMPLETED,
      pickupDate: at(3),
    });
    const refunded = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.CANCEL_REFUND_COMPLETED,
      pickupDate: at(-1),
    });
    // 픽업 시각이 지났지만 아직 처리하지 않은 주문(판매자 앱에서는 "처리할 것" 탭)
    await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.PICKUP_PENDING,
      pickupDate: at(-1),
    });
    await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(2),
    });

    const result = await service.getOrdersForSeller(
      {
        page: 1,
        limit: 20,
        sortBy: OrderSortBy.PICKUP_DESC,
        storeId: store.id,
        type: OrderType.FINISHED,
      },
      user,
    );

    expect(result.data.map((o) => o.id)).toEqual([
      canceled.id,
      refunded.id,
      noShow.id,
      completedOld.id,
    ]);
    expect(result.meta.totalItems).toBe(4);
  });

  it("픽업 가까운 순은 픽업 일시 오름차순이고 픽업 일시가 없는 주문은 맨 뒤다", async () => {
    const { prisma, refs, store, service, user } = await setup();
    const later = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(4),
    });
    const noPickup = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: null,
    });
    const sooner = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(1),
    });

    const result = await service.getOrdersForSeller(
      {
        page: 1,
        limit: 20,
        sortBy: OrderSortBy.PICKUP_ASC,
        storeId: store.id,
        orderStatus: OrderStatus.RESERVATION_REQUESTED,
      },
      user,
    );

    expect(result.data.map((o) => o.id)).toEqual([sooner.id, later.id, noPickup.id]);
  });

  it("검색어 하나로 예약자 이름·전화번호 뒷자리·상품명·주문번호를 함께 찾는다", async () => {
    const { prisma, refs, store, service, user } = await setup();
    const kim = await createTestOrder(prisma, refs, {
      reservationContactName: "김하늘",
      reservationPhone: "01012345678",
      productName: "딸기 생크림 케이크",
      orderNumber: "ORD-20261110-001",
    });
    const lee = await createTestOrder(prisma, refs, {
      reservationContactName: "이바다",
      reservationPhone: "01099990000",
      productName: "초코 레터링 케이크",
      orderNumber: "ORD-20261110-002",
    });
    const find = async (keyword: string) =>
      (
        await service.getOrdersForSeller(
          { page: 1, limit: 20, sortBy: OrderSortBy.PICKUP_ASC, storeId: store.id, keyword },
          user,
        )
      ).data
        .map((o) => o.id)
        .sort();

    expect(await find("하늘")).toEqual([kim.id]);
    expect(await find("5678")).toEqual([kim.id]);
    expect(await find("010-9999-0000")).toEqual([lee.id]);
    expect(await find("초코")).toEqual([lee.id]);
    expect(await find("ord-20261110-001")).toEqual([kim.id]);
    expect(await find("케이크")).toEqual([kim.id, lee.id].sort());
    // 숫자 3자리 이하는 전화번호로 찾지 않는다(주문번호·상품명에 든 숫자만)
    expect(await find("567")).toEqual([]);
    expect(await find("없는 이름")).toEqual([]);
  });
});
