import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { StoreBusinessCalendarService } from "@apps/backend/modules/store/services/store-business-calendar.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 영업 캘린더를 바꿀 때 진행 중인 예약을 보호하는지 확인합니다.
 * (네이버 영업시간을 캘린더에 반영할 때도 같은 저장 경로를 씁니다. 기획 I-10 3단계)
 */
describe("영업 캘린더 저장과 기존 예약 보호 (integration)", () => {
  // 2030-01-08(화) 14:00 KST = 05:00 UTC
  const TUESDAY_2PM_KST = new Date("2030-01-08T05:00:00.000Z");
  const DAY_OVERRIDE = { date: "2030-02-01", isOpen: false };

  async function setup(orderStatus: OrderStatus) {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, {
      businessCalendarOverrides: [DAY_OVERRIDE],
    });
    const product = await createTestProduct(prisma, store.id);
    const consumer = await createTestConsumer(prisma);
    await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      { orderStatus, pickupDate: TUESDAY_2PM_KST },
    );
    const service = new StoreBusinessCalendarService(prisma);
    const user = { sub: seller.id } as JwtVerifiedPayload;
    return { prisma, store, service, user };
  }

  const calendar = (weeklyClosedWeekdays: number[], open = "11:00", close = "19:00") => ({
    weeklyClosedWeekdays,
    standardOpenTime: open,
    standardCloseTime: close,
    dayOverrides: [DAY_OVERRIDE],
  });

  it("진행 중인 예약이 있는 요일을 정기 휴무로 바꾸면 저장하지 않고 예약을 알려 준다", async () => {
    const { prisma, store, service, user } = await setup(OrderStatus.CONFIRMED);

    const error = await service.updateForSeller(store.id, calendar([2]), user).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ code: "BUSINESS_CALENDAR_ORDER_CONFLICT" });
    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.weeklyClosedWeekdays).toEqual([]);
  });

  it("예약 시각이 새 영업시간 밖이어도 저장하지 않는다", async () => {
    const { service, store, user } = await setup(OrderStatus.RESERVATION_REQUESTED);

    await expect(
      service.updateForSeller(store.id, calendar([], "15:00", "19:00"), user),
    ).rejects.toThrow(BadRequestException);
  });

  it("예약과 겹치지 않는 변경은 저장하고 날짜별 예외는 그대로 둔다", async () => {
    const { prisma, store, service, user } = await setup(OrderStatus.CONFIRMED);

    await service.updateForSeller(store.id, calendar([1]), user);

    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.weeklyClosedWeekdays).toEqual([1]);
    expect(saved.standardOpenTime).toBe("11:00");
    expect(saved.businessCalendarOverrides).toEqual([DAY_OVERRIDE]);
  });

  it("끝난 예약(픽업 완료)은 막지 않는다", async () => {
    const { prisma, store, service, user } = await setup(OrderStatus.PICKUP_COMPLETED);

    await service.updateForSeller(store.id, calendar([2]), user);

    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.weeklyClosedWeekdays).toEqual([2]);
  });
});
