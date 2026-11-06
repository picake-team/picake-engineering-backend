import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import type { OrderStatusTransitionPayload } from "@apps/backend/modules/order/types/order-lifecycle.types";
import {
  isAdminStatusUpdate,
  isPaymentExpiredCancelSource,
  isReservationRequestedOnCreate,
  isSellerStatusUpdate,
  isUserAction,
} from "@apps/backend/modules/notification/utils/user-order-notification-transition.util";

export type OrderNotificationCopy = { title: string; body: string };

/**
 * 주문 상태 전환 payload를 바로 받아 문구를 결정합니다.
 * - kind/event 같은 중간 식별자는 사용하지 않습니다.
 */
export function buildSellerOrderNotificationCopy(
  payload: Pick<OrderStatusTransitionPayload, "fromStatus" | "toStatus" | "source">,
): OrderNotificationCopy | null {
  const { toStatus } = payload;

  if (isReservationRequestedOnCreate(payload)) {
    return {
      title: "예약 신청이 들어왔습니다",
      body: "고객이 주문을 신청했습니다. 예약을 확인해 주세요.",
    };
  }

  if (toStatus === OrderStatus.PAYMENT_PENDING) {
    return {
      title: "입금 대기 안내가 전달되었습니다",
      body: "예약 확인으로 바꾸면서 고객에게 입금 안내가 갔습니다.",
    };
  }

  if (toStatus === OrderStatus.PAYMENT_COMPLETED) {
    return {
      title: "입금이 완료되었습니다",
      body: "고객이 입금 확인 처리했습니다. 이어서 진행해 주세요.",
    };
  }

  if (toStatus === OrderStatus.CONFIRMED) {
    return {
      title: "예약이 확정되었습니다",
      body: "주문이 예약 확정 상태입니다. 픽업 일정을 확인해 주세요.",
    };
  }

  if (toStatus === OrderStatus.PICKUP_PENDING) {
    return {
      title: "픽업 대기입니다",
      body: "픽업 준비가 되었습니다. 픽업 완료 여부를 확인해 주세요.",
    };
  }

  if (toStatus === OrderStatus.PICKUP_COMPLETED) {
    return {
      title: "픽업이 완료되었습니다",
      body: "픽업 완료로 처리했습니다.",
    };
  }

  if (toStatus === OrderStatus.CANCEL_COMPLETED) {
    if (isPaymentExpiredCancelSource(payload)) {
      return {
        title: "입금 기한이 지나 주문이 취소되었습니다",
        body: "입금 대기 시간이 만료되어 취소 처리되었습니다.",
      };
    }
    if (isUserAction(payload)) {
      return {
        title: "고객이 주문을 취소했습니다",
        body: "고객 취소가 반영되었습니다.",
      };
    }
    if (isSellerStatusUpdate(payload)) {
      return {
        title: "판매자 취소가 반영되었습니다",
        body: "주문이 취소 처리되었습니다.",
      };
    }
    return null;
  }

  if (toStatus === OrderStatus.CANCEL_REFUND_PENDING) {
    if (isUserAction(payload)) {
      return {
        title: "고객이 환불을 요청했습니다",
        body: "취소·환불 대기로 접수되었습니다. 내용을 확인해 주세요.",
      };
    }
    if (isSellerStatusUpdate(payload)) {
      return {
        title: "환불 대기로 변경했습니다",
        body: "취소·환불 대기 상태입니다. 고객 안내와 환불 처리를 진행해 주세요.",
      };
    }
    // 취소완료로 종료됐던 주문을 관리자가 되돌린 경우. 판매자가 예상하지 못한 변화라 경위를 밝힙니다.
    if (isAdminStatusUpdate(payload)) {
      return {
        title: "관리자가 환불 대기로 전환했습니다",
        body: "취소완료였던 주문입니다. 고객 입금 내역을 확인한 뒤 환불을 진행해 주세요.",
      };
    }
    return null;
  }

  if (toStatus === OrderStatus.CANCEL_REFUND_COMPLETED) {
    return {
      title: "환불이 완료되었습니다",
      body: "환불 처리가 완료되었습니다.",
    };
  }

  if (toStatus === OrderStatus.NO_SHOW) {
    return {
      title: "노쇼 처리되었습니다",
      body: "노쇼로 기록된 주문입니다.",
    };
  }

  return null;
}

/**
 * 판매자 앱 휴대폰 푸시를 보낼지 (기획 I-48).
 * 판매자가 직접 바꾼 상태는 이미 알고 있으므로 보내지 않고, 손님·자동 처리·관리자가 만든 변화만 보냅니다
 * (새 예약신청, 입금완료, 손님 취소·환불 요청, 입금 기한 만료 취소, 관리자 변경).
 * 픽업 시각이 되어 픽업대기로 바뀐 것도 보내지 않습니다. 하루 픽업이 많으면 알림이 쏟아지고,
 * 그날 픽업은 아침 요약 알림이 대신 알려 줍니다.
 * 판매자 페이지 안 알림(SELLER_WEB)은 이와 관계없이 지금처럼 모두 만듭니다.
 */
export function shouldSendSellerOrderPush(
  payload: Pick<OrderStatusTransitionPayload, "source" | "toStatus">,
): boolean {
  if (isSellerStatusUpdate(payload)) return false;
  if (payload.toStatus === OrderStatus.PICKUP_PENDING) return false;
  return true;
}

const KST_TIME_ZONE = "Asia/Seoul";

/** 픽업 일시를 판매자 알림 모양으로: "11월 12일(수) 14:00" (Asia/Seoul) */
export function formatSellerPickupDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}월 ${get("day")}일(${get("weekday")}) ${get("hour")}:${get("minute")}`;
}

/**
 * 판매자 알림 내용(휴대폰 알림과 판매자 페이지 안 알림이 같음, 기획 I-48).
 * "무화과 케이크 · 11월 12일(수) 14:00 픽업", 여러 개면 "레터링 미니 케이크 2개 · …".
 * 잠금 화면에 보이므로 손님 이름·연락처는 넣지 않습니다. 상품 이름이 없으면 null.
 */
export function buildSellerOrderSummaryBody(order: {
  productName: string | null;
  totalQuantity: number;
  pickupDate: Date | null;
}): string | null {
  const name = order.productName?.trim();
  if (!name) return null;
  const product = order.totalQuantity > 1 ? `${name} ${order.totalQuantity}개` : name;
  return order.pickupDate
    ? `${product} · ${formatSellerPickupDateTime(order.pickupDate)} 픽업`
    : product;
}

/** 스토어가 둘 이상인 사장님은 휴대폰 알림 제목 앞에 [스토어 이름]을 붙입니다(어느 스토어 일인지 알게). */
export function withSellerStorePrefix(
  title: string,
  storeName: string,
  sellerStoreCount: number,
): string {
  return sellerStoreCount > 1 ? `[${storeName}] ${title}` : title;
}
