import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";
import type { OrderStatusTransitionPayload } from "@apps/backend/modules/order/types/order-lifecycle.types";

type OrderNotificationTransitionContext = Pick<
  OrderStatusTransitionPayload,
  "fromStatus" | "toStatus" | "source"
>;

/** 주문 생성 직후 예약신청 전환 */
export function isReservationRequestedOnCreate(ctx: OrderNotificationTransitionContext): boolean {
  return (
    ctx.toStatus === OrderStatus.RESERVATION_REQUESTED &&
    ctx.fromStatus === null &&
    ctx.source === ORDER_STATUS_TRANSITION_SOURCE.ORDER_CREATE
  );
}

/**
 * 입금 마감 초과로 인한 취소완료 전환.
 * (자동 배치·동기화·만료 상태에서 입금 시도)
 */
export function isPaymentExpiredCancelSource(
  ctx: Pick<OrderStatusTransitionPayload, "fromStatus" | "source">,
): boolean {
  return (
    ctx.fromStatus === OrderStatus.PAYMENT_PENDING &&
    (ctx.source === ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH ||
      ctx.source === ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC ||
      ctx.source === ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION_PAYMENT_EXPIRED)
  );
}

/**
 * 가게가 픽업 날이 지나도록 확인하지 않은 예약신청의 자동 취소(2026-11-16).
 * 입금대기 만료와 같은 자동 경로지만 이전 상태가 예약신청이다.
 */
export function isReservationExpiredCancelSource(
  ctx: Pick<OrderStatusTransitionPayload, "fromStatus" | "source">,
): boolean {
  return (
    ctx.fromStatus === OrderStatus.RESERVATION_REQUESTED &&
    (ctx.source === ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH ||
      ctx.source === ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC)
  );
}

/** 판매자 주문 상태 변경 */
export function isSellerStatusUpdate(ctx: Pick<OrderStatusTransitionPayload, "source">): boolean {
  return ctx.source === ORDER_STATUS_TRANSITION_SOURCE.SELLER_STATUS_UPDATE;
}

/** 사용자 직접 액션 (입금 완료·취소·환불 요청 등) */
export function isUserAction(ctx: Pick<OrderStatusTransitionPayload, "source">): boolean {
  return ctx.source === ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION;
}

/** 관리자 주문 상태 변경 (취소완료 → 취소환불대기 되돌리기) */
export function isAdminStatusUpdate(ctx: Pick<OrderStatusTransitionPayload, "source">): boolean {
  return ctx.source === ORDER_STATUS_TRANSITION_SOURCE.ADMIN_STATUS_UPDATE;
}
