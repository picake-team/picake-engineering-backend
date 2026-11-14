import { BadRequestException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ORDER_ERROR_MESSAGES,
  OrderStatus,
} from "@apps/backend/modules/order/constants/order.constants";
import { OrderOwnershipUtil } from "@apps/backend/modules/order/utils/order-ownership.util";

import { OrderSellerActionService } from "./order-seller-action.service";
import { OrderUserActionService } from "./order-user-action.service";

/**
 * 손님·사장님 주문 상태 바꾸기는 "읽은 상태 그대로일 때만" 쓴다.
 * 읽은 뒤 쓰기 전에 자동 작업(입금 마감 취소)·다른 쪽이 먼저 바꾸면 덮어쓰지 않는다(취소된 주문이 되살아나지 않게).
 */
describe("주문 상태 바꾸기: 그사이 상태가 바뀌면 덮어쓰지 않는다", () => {
  const hook = { afterOrderStatusTransition: vi.fn() };
  const automation = { syncOrderLifecycleById: vi.fn().mockResolvedValue(undefined) };
  let prisma: {
    order: {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(OrderOwnershipUtil, "verifyOrderUserOwnership").mockResolvedValue(undefined as never);
    vi.spyOn(OrderOwnershipUtil, "verifyOrderStoreOwnership").mockResolvedValue(undefined as never);
    // update는 옛 코드(조건 없이 쓰기)가 부르던 것 — 새 코드는 부르지 않아야 한다
    prisma = {
      order: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    };
  });
  afterEach(() => vi.restoreAllMocks());

  const user = () =>
    new OrderUserActionService(prisma as never, automation as never, hook as never);
  const seller = () =>
    new OrderSellerActionService(prisma as never, automation as never, hook as never);

  // 입금 마감까지 넉넉한 입금대기 주문
  const pendingOrder = () => {
    const now = Date.now();
    return {
      orderStatus: OrderStatus.PAYMENT_PENDING,
      createdAt: new Date(now - 3600_000),
      paymentPendingAt: new Date(now - 60_000),
      paymentPendingDeadlineAt: new Date(now + 6 * 3600_000),
      pickupDate: new Date(now + 3 * 86400_000),
    };
  };

  it("손님 입금 완료: 그사이 자동 취소됐으면 되살리지 않고 마감 안내 + 입금자명만 남긴다", async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce(pendingOrder())
      .mockResolvedValueOnce({ orderStatus: OrderStatus.CANCEL_COMPLETED });
    prisma.order.updateMany
      .mockResolvedValueOnce({ count: 0 }) // PAYMENT_PENDING → PAYMENT_COMPLETED 실패
      .mockResolvedValueOnce({ count: 1 }); // 입금자명 기록

    await expect(
      user().markPaymentCompleted("o1", "u1", { depositorName: "홍길동" } as never),
    ).rejects.toThrow(new BadRequestException(ORDER_ERROR_MESSAGES.PAYMENT_PENDING_EXPIRED));

    expect(prisma.order.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "o1", orderStatus: OrderStatus.PAYMENT_PENDING },
      data: { orderStatus: OrderStatus.PAYMENT_COMPLETED, depositorName: "홍길동" },
    });
    expect(prisma.order.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "o1", depositorName: null },
      data: { depositorName: "홍길동" },
    });
    expect(hook.afterOrderStatusTransition).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("손님 입금 완료: 바뀌지 않았으면 그대로 입금완료 + 알림 한 번", async () => {
    prisma.order.findUnique.mockResolvedValueOnce(pendingOrder());
    prisma.order.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      user().markPaymentCompleted("o1", "u1", { depositorName: "홍길동" } as never),
    ).resolves.toEqual({ id: "o1" });
    expect(hook.afterOrderStatusTransition).toHaveBeenCalledTimes(1);
  });

  it("손님 입금 전 취소: 그사이 사장님이 바꿨으면 취소하지 않는다", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
    });
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      user().cancelBeforePayment("o1", "u1", { reason: "일정 변경" } as never),
    ).rejects.toThrow(new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_USER_ORDER_ACTION));
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o1", orderStatus: OrderStatus.RESERVATION_REQUESTED },
      }),
    );
    expect(hook.afterOrderStatusTransition).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("사장님 상태 바꾸기: 그사이 손님이 취소했으면 덮어쓰지 않는다(앱은 '그사이 바뀌었어요'로 안내)", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: new Date(Date.now() + 3 * 86400_000),
    });
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      seller().updateOrderStatusForSeller(
        "o1",
        { orderStatus: OrderStatus.PAYMENT_PENDING } as never,
        "s1",
      ),
    ).rejects.toThrow(new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_STATUS_TRANSITION));
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o1", orderStatus: OrderStatus.RESERVATION_REQUESTED },
      }),
    );
    expect(hook.afterOrderStatusTransition).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("사장님 예약 확인: 픽업 시간이 지났으면 막는다(입금 안내 뒤 바로 자동 취소가 가지 않게)", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: new Date(Date.now() - 60_000),
    });

    await expect(
      seller().updateOrderStatusForSeller(
        "o1",
        { orderStatus: OrderStatus.PAYMENT_PENDING } as never,
        "s1",
      ),
    ).rejects.toThrow(new BadRequestException(ORDER_ERROR_MESSAGES.PICKUP_PASSED_CANNOT_CONFIRM));
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(hook.afterOrderStatusTransition).not.toHaveBeenCalled();
  });

  it("사장님 예약 확정: 픽업까지 하루가 안 남았으면 전날 안내를 보내지 않게 표시한다(M-03 문구와 같게)", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      orderStatus: OrderStatus.PAYMENT_COMPLETED,
      pickupDate: new Date(Date.now() + 5 * 3600_000),
    });
    prisma.order.updateMany.mockResolvedValueOnce({ count: 1 });

    await seller().updateOrderStatusForSeller(
      "o1",
      { orderStatus: OrderStatus.CONFIRMED } as never,
      "s1",
    );
    const data = prisma.order.updateMany.mock.calls[0][0].data;
    expect(data.orderStatus).toBe(OrderStatus.CONFIRMED);
    expect(data.pickupReminderSentAt).toBeInstanceOf(Date);
  });

  it("사장님 예약 확정: 하루 넘게 남았으면 전날 안내는 예약 작업이 보낸다(표시하지 않음)", async () => {
    prisma.order.findUnique.mockResolvedValueOnce({
      orderStatus: OrderStatus.PAYMENT_COMPLETED,
      pickupDate: new Date(Date.now() + 3 * 86400_000),
    });
    prisma.order.updateMany.mockResolvedValueOnce({ count: 1 });

    await seller().updateOrderStatusForSeller(
      "o1",
      { orderStatus: OrderStatus.CONFIRMED } as never,
      "s1",
    );
    expect(prisma.order.updateMany.mock.calls[0][0].data.pickupReminderSentAt).toBeUndefined();
  });
});
