import { describe, expect, it } from "vitest";

import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";

import { buildUserOrderNotificationCopy } from "./user-order-notification-copy.util";

describe("buildUserOrderNotificationCopy — 자동 취소", () => {
  it("가게가 확인하지 않은 예약신청 자동 취소는 손님에게 그 이유로 알린다(배치·조회 모두)", () => {
    for (const source of [
      ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
      ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC,
    ]) {
      expect(
        buildUserOrderNotificationCopy({
          fromStatus: OrderStatus.RESERVATION_REQUESTED,
          toStatus: OrderStatus.CANCEL_COMPLETED,
          source,
        })?.title,
      ).toBe("가게가 확인하지 않아 예약이 취소되었어요");
    }
  });

  it("입금대기 만료·손님 취소 문구는 그대로", () => {
    expect(
      buildUserOrderNotificationCopy({
        fromStatus: OrderStatus.PAYMENT_PENDING,
        toStatus: OrderStatus.CANCEL_COMPLETED,
        source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
      })?.title,
    ).toBe("입금 시간이 지나 주문이 취소되었어요");
    expect(
      buildUserOrderNotificationCopy({
        fromStatus: OrderStatus.RESERVATION_REQUESTED,
        toStatus: OrderStatus.CANCEL_COMPLETED,
        source: ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION,
      })?.title,
    ).toBe("주문 취소가 완료되었어요");
  });
});
