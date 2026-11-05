import { describe, expect, it } from "vitest";

import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";

import {
  buildSellerOrderNotificationCopy,
  shouldSendSellerOrderPush,
} from "./seller-order-notification-copy.util";

describe("shouldSendSellerOrderPush", () => {
  it("새 예약신청(주문 생성)은 푸시를 보낸다", () => {
    expect(shouldSendSellerOrderPush({ source: ORDER_STATUS_TRANSITION_SOURCE.ORDER_CREATE })).toBe(
      true,
    );
  });

  it("손님이 한 일(입금완료·취소·환불 요청)은 푸시를 보낸다", () => {
    expect(shouldSendSellerOrderPush({ source: ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION })).toBe(
      true,
    );
  });

  it("입금 기한 만료 자동 취소와 관리자 변경은 푸시를 보낸다", () => {
    expect(
      shouldSendSellerOrderPush({ source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH }),
    ).toBe(true);
    expect(
      shouldSendSellerOrderPush({ source: ORDER_STATUS_TRANSITION_SOURCE.ADMIN_STATUS_UPDATE }),
    ).toBe(true);
  });

  it("판매자가 직접 바꾼 상태는 푸시를 보내지 않는다", () => {
    expect(
      shouldSendSellerOrderPush({ source: ORDER_STATUS_TRANSITION_SOURCE.SELLER_STATUS_UPDATE }),
    ).toBe(false);
  });
});

describe("buildSellerOrderNotificationCopy", () => {
  it("새 예약신청 문구", () => {
    expect(
      buildSellerOrderNotificationCopy({
        fromStatus: null,
        toStatus: OrderStatus.RESERVATION_REQUESTED,
        source: ORDER_STATUS_TRANSITION_SOURCE.ORDER_CREATE,
      }),
    ).toEqual({
      title: "예약 신청이 들어왔습니다",
      body: "고객이 주문을 신청했습니다. 예약을 확인해 주세요.",
    });
  });

  it("입금완료 문구", () => {
    expect(
      buildSellerOrderNotificationCopy({
        fromStatus: OrderStatus.PAYMENT_PENDING,
        toStatus: OrderStatus.PAYMENT_COMPLETED,
        source: ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION,
      })?.title,
    ).toBe("입금이 완료되었습니다");
  });
});
