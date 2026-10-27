import { describe, expect, it, vi } from "vitest";

import { OrderUserReservationEditService } from "@apps/backend/modules/order/services/order-user-reservation-edit.service";
import type { OrderAutomationService } from "@apps/backend/modules/order/services/order-automation.service";
import { ORDER_ERROR_MESSAGES } from "@apps/backend/modules/order/constants/order.constants";
import {
  CustomOptionType,
  EnableStatus,
} from "@apps/backend/modules/product/constants/product.constants";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

const SIZE_OPTIONS = [
  { id: "size_mini", visible: EnableStatus.ENABLE, displayName: "미니", lengthCm: 10, price: 0 },
];
const FLAVOR_OPTIONS = [
  { id: "flavor_choco", visible: EnableStatus.ENABLE, displayName: "초코", price: 0 },
];
const candleOption = (bigPrice: number) => ({
  id: "opt_candle",
  type: CustomOptionType.SINGLE_SELECT,
  name: "초 추가",
  required: false,
  visible: EnableStatus.ENABLE,
  choices: [
    { id: "c_none", label: "없음", price: 0, visible: EnableStatus.ENABLE },
    { id: "c_big", label: "큰초", price: bigPrice, visible: EnableStatus.ENABLE },
  ],
});

/**
 * 예약신청 단계 항목 단건 변경: 변경한 항목만 현재 상품 기준으로 다시 계산하고
 * 다른 항목의 주문 시점 옵션·금액은 그대로 유지되는지 실제 DB로 확인합니다.
 */
describe("OrderUserReservationEditService.updateOrderItem (integration)", () => {
  function buildService(prisma = getTestPrisma()) {
    const automation = {
      syncOrderLifecycleById: vi.fn(),
    } as unknown as OrderAutomationService;
    return new OrderUserReservationEditService(prisma, automation);
  }

  async function setupOrderWithTwoItems() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const product = await createTestProduct(prisma, store.id, {
      cakeSizeOptions: SIZE_OPTIONS,
      cakeFlavorOptions: FLAVOR_OPTIONS,
      customOptions: [candleOption(1000)],
      optionsVersion: 1,
    });
    const consumer = await createTestConsumer(prisma);

    const snapshot = {
      sizeId: "size_mini",
      sizeDisplayName: "미니",
      sizeLengthCm: 10,
      sizePrice: 0,
      flavorId: "flavor_choco",
      flavorDisplayName: "초코",
      flavorPrice: 0,
      selectedOptions: [
        {
          optionId: "opt_candle",
          type: CustomOptionType.SINGLE_SELECT,
          name: "초 추가",
          choices: [{ id: "c_big", label: "큰초", price: 1000 }],
          price: 1000,
        },
      ],
      optionsPrice: 1000,
      quantity: 1,
      itemPrice: 31000,
    };
    const order = await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      {
        totalQuantity: 2,
        totalPrice: 62000,
        orderItems: { create: [snapshot, snapshot] },
      },
    );
    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
    });

    // 주문 이후 판매자가 큰초 가격을 올림
    await prisma.product.update({
      where: { id: product.id },
      data: { customOptions: [candleOption(3000)], optionsVersion: 2 },
    });

    return { prisma, consumer, order, items };
  }

  it("변경한 항목만 현재 가격으로 다시 계산하고, 다른 항목은 주문 시점 금액을 유지한다", async () => {
    const { prisma, consumer, order, items } = await setupOrderWithTwoItems();
    const service = buildService(prisma);

    await service.updateOrderItem(order.id, items[0].id, consumer.id, {
      sizeId: "size_mini",
      flavorId: "flavor_choco",
      quantity: 2,
      options: [{ optionId: "opt_candle", choiceIds: ["c_big"] }],
      // 다른 항목 31000×1 + 변경 항목 (30000+3000)×2
      totalPrice: 31000 + 33000 * 2,
      productOptionsVersion: 2,
    });

    const saved = await prisma.order.findUnique({
      where: { id: order.id },
      include: { orderItems: true },
    });
    const edited = saved!.orderItems.find((item) => item.id === items[0].id)!;
    const untouched = saved!.orderItems.find((item) => item.id === items[1].id)!;

    expect(saved!.totalPrice).toBe(31000 + 66000);
    expect(saved!.totalQuantity).toBe(3);
    expect(edited.itemPrice).toBe(33000);
    expect(edited.optionsPrice).toBe(3000);
    expect(untouched.itemPrice).toBe(31000);
    expect(untouched.selectedOptions).toEqual(items[1].selectedOptions);
  });

  it("옵션 버전이 다르면 409로 거절하고 아무것도 바꾸지 않는다", async () => {
    const { prisma, consumer, order, items } = await setupOrderWithTwoItems();
    const service = buildService(prisma);

    await expect(
      service.updateOrderItem(order.id, items[0].id, consumer.id, {
        sizeId: "size_mini",
        flavorId: "flavor_choco",
        quantity: 1,
        options: [],
        totalPrice: 31000 + 30000,
        productOptionsVersion: 1,
      }),
    ).rejects.toThrow(ORDER_ERROR_MESSAGES.PRODUCT_OPTIONS_CHANGED);

    const saved = await prisma.order.findUnique({ where: { id: order.id } });
    expect(saved!.totalPrice).toBe(62000);
  });
});
