import { describe, expect, it, vi } from "vitest";

import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { OrderAutomationService } from "@apps/backend/modules/order/services/order-automation.service";
import type { OrderLifecycleHookService } from "@apps/backend/modules/order/services/order-lifecycle-hook.service";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";
import { AuthWithdrawService } from "@apps/backend/modules/auth/services/auth-withdraw.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import type { AuthAppleOauthService } from "@apps/backend/modules/auth/services/auth-apple-oauth.service";
import type { AuthKakaoOauthService } from "@apps/backend/modules/auth/services/auth-kakao-oauth.service";
import type { QuoteRequestCleanupService } from "@apps/backend/modules/quote-request/services/quote-request-cleanup.service";
import type { ChatCleanupService } from "@apps/backend/modules/chat/services/chat-cleanup.service";
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
 * 가게가 픽업 날이 지나도록 확인하지 않은 예약신청 자동 취소(2026-11-16)를 실제 Postgres로 확인한다.
 * 답이 없는 예약신청이 "진행 중"으로 남아 손님이 탈퇴하지 못하던 문제.
 */
describe("확인하지 않은 예약신청 자동 취소 (integration)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(Date.now() + ms);

  async function setup() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const product = await createTestProduct(prisma, store.id);
    const consumer = await createTestConsumer(prisma);
    const refs = { consumerId: consumer.id, productId: product.id, storeId: store.id };
    const afterOrderStatusTransition = vi.fn();
    const automation = new OrderAutomationService(
      prisma,
      { afterOrderStatusTransition } as unknown as OrderLifecycleHookService,
      createNotificationOrderDispatchNoopMock(),
    );
    return { prisma, refs, consumer, automation, afterOrderStatusTransition };
  }

  it("배치: 픽업 날이 지난 예약신청은 취소완료(reservationExpiredAt)로, 어제 픽업은 알리고 오래된 건 조용히", async () => {
    const { prisma, refs, automation, afterOrderStatusTransition } = await setup();
    // 어제 픽업 → 오늘 0시(한국 시간)에 만료, 만료된 지 하루 안이라 알림
    const yesterday = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(-DAY),
    });
    // 몇 달 전 픽업 → 알림 없이 취소
    const old = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(-120 * DAY),
    });
    // 아직 오지 않은 픽업은 그대로
    const future = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(2 * DAY),
    });
    // 사장님이 이미 확인한 주문은 이 규칙과 상관없다(예약확정 → 픽업대기 규칙만)
    const confirmed = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.PAYMENT_COMPLETED,
      pickupDate: at(-DAY),
    });

    await automation.runBatchTransitions();

    const rows = await prisma.order.findMany({
      where: { id: { in: [yesterday.id, old.id, future.id, confirmed.id] } },
      select: { id: true, orderStatus: true, reservationExpiredAt: true, canceledAt: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of [yesterday.id, old.id]) {
      expect(byId.get(id)?.orderStatus).toBe(OrderStatus.CANCEL_COMPLETED);
      expect(byId.get(id)?.reservationExpiredAt).toBeInstanceOf(Date);
      expect(byId.get(id)?.canceledAt).toBeInstanceOf(Date);
    }
    expect(byId.get(future.id)?.orderStatus).toBe(OrderStatus.RESERVATION_REQUESTED);
    expect(byId.get(future.id)?.reservationExpiredAt).toBeNull();
    expect(byId.get(confirmed.id)?.orderStatus).toBe(OrderStatus.PAYMENT_COMPLETED);

    const notified = afterOrderStatusTransition.mock.calls.map((c) => c[0]);
    expect(notified).toContainEqual({
      orderId: yesterday.id,
      fromStatus: OrderStatus.RESERVATION_REQUESTED,
      toStatus: OrderStatus.CANCEL_COMPLETED,
      source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
    });
    expect(notified.some((p) => p.orderId === old.id)).toBe(false);

    // 다시 돌려도 두 번 바꾸거나 두 번 알리지 않는다
    afterOrderStatusTransition.mockClear();
    await automation.runBatchTransitions();
    expect(afterOrderStatusTransition.mock.calls.some((c) => c[0].orderId === yesterday.id)).toBe(
      false,
    );
  });

  it("조회(sync): 주문을 열 때도 같은 규칙으로 취소한다", async () => {
    const { prisma, refs, automation, afterOrderStatusTransition } = await setup();
    const order = await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(-DAY),
    });

    await automation.syncOrderLifecycleById(order.id);

    const row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.orderStatus).toBe(OrderStatus.CANCEL_COMPLETED);
    expect(afterOrderStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC,
      }),
    );
  });

  it("답이 없던 예약신청이 취소되면 손님이 탈퇴할 수 있다", async () => {
    const { prisma, refs, consumer, automation } = await setup();
    await createTestOrder(prisma, refs, {
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      pickupDate: at(-30 * DAY),
    });
    const withdraw = new AuthWithdrawService(
      prisma,
      { revokeToken: vi.fn() } as unknown as AuthAppleOauthService,
      { unlink: vi.fn() } as unknown as AuthKakaoOauthService,
      {
        deleteAllForConsumer: vi.fn().mockResolvedValue({ requests: 0, photos: 0 }),
      } as unknown as QuoteRequestCleanupService,
      {
        deleteAllForConsumer: vi.fn().mockResolvedValue({ messages: 0, photos: 0 }),
      } as unknown as ChatCleanupService,
    );

    await expect(withdraw.withdraw(AUDIENCE.CONSUMER, consumer.id, "테스트")).rejects.toThrow();

    await automation.runBatchTransitions();
    await withdraw.withdraw(AUDIENCE.CONSUMER, consumer.id, "테스트");

    const row = await prisma.consumer.findUnique({ where: { id: consumer.id } });
    expect(row?.withdrawnAt).toBeInstanceOf(Date);
  });
});
