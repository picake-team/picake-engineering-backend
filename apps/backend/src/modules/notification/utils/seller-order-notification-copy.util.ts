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
 * - 판매자 앱 화면과 같은 해요체, 손님은 "손님"이라 부릅니다(기획 I-48).
 * - kind/event 같은 중간 식별자는 사용하지 않습니다.
 */
export function buildSellerOrderNotificationCopy(
  payload: Pick<OrderStatusTransitionPayload, "fromStatus" | "toStatus" | "source">,
): OrderNotificationCopy | null {
  const { toStatus } = payload;

  if (isReservationRequestedOnCreate(payload)) {
    return {
      title: "새 예약 신청이 왔어요",
      body: "손님이 예약을 신청했어요. 예약을 확인해 주세요.",
    };
  }

  if (toStatus === OrderStatus.PAYMENT_PENDING) {
    return {
      title: "손님에게 입금 안내를 보냈어요",
      body: "예약을 확인해서 손님에게 입금 안내가 갔어요.",
    };
  }

  if (toStatus === OrderStatus.PAYMENT_COMPLETED) {
    return {
      title: "손님이 입금했어요",
      body: "통장을 확인하고 예약을 확정해 주세요.",
    };
  }

  if (toStatus === OrderStatus.CONFIRMED) {
    return {
      title: "예약이 확정됐어요",
      body: "픽업 일정을 확인해 주세요.",
    };
  }

  if (toStatus === OrderStatus.PICKUP_PENDING) {
    return {
      title: "픽업을 기다리고 있어요",
      body: "손님이 가져가면 픽업 완료를 눌러 주세요.",
    };
  }

  if (toStatus === OrderStatus.PICKUP_COMPLETED) {
    return {
      title: "픽업이 완료됐어요",
      body: "픽업 완료로 처리했어요.",
    };
  }

  if (toStatus === OrderStatus.CANCEL_COMPLETED) {
    if (isPaymentExpiredCancelSource(payload)) {
      return {
        title: "입금 기한이 지나 주문이 취소됐어요",
        body: "입금 마감까지 입금이 없어 자동으로 취소됐어요.",
      };
    }
    if (isUserAction(payload)) {
      return {
        title: "손님이 주문을 취소했어요",
        body: "입금 전에 손님이 취소했어요.",
      };
    }
    if (isSellerStatusUpdate(payload)) {
      return {
        title: "예약을 취소했어요",
        body: "주문을 취소로 처리했어요.",
      };
    }
    return null;
  }

  if (toStatus === OrderStatus.CANCEL_REFUND_PENDING) {
    if (isUserAction(payload)) {
      return {
        title: "손님이 환불을 요청했어요",
        body: "취소·환불 대기로 바뀌었어요. 내용을 확인해 주세요.",
      };
    }
    if (isSellerStatusUpdate(payload)) {
      return {
        title: "환불 대기로 바꿨어요",
        body: "손님에게 안내하고 환불해 주세요.",
      };
    }
    // 취소완료로 종료됐던 주문을 관리자가 되돌린 경우. 판매자가 예상하지 못한 변화라 경위를 밝힙니다.
    if (isAdminStatusUpdate(payload)) {
      return {
        title: "관리자가 환불 대기로 바꿨어요",
        body: "취소완료였던 주문이에요. 손님 입금 내역을 확인하고 환불해 주세요.",
      };
    }
    return null;
  }

  if (toStatus === OrderStatus.CANCEL_REFUND_COMPLETED) {
    return {
      title: "환불이 완료됐어요",
      body: "환불 완료로 처리했어요.",
    };
  }

  if (toStatus === OrderStatus.NO_SHOW) {
    return {
      title: "노쇼로 처리했어요",
      body: "노쇼로 기록된 주문이에요.",
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
