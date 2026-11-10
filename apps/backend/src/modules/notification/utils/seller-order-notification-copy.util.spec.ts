import { describe, expect, it } from "vitest";

import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";

import {
  buildSellerOrderNotificationCopy,
  buildSellerOrderSummaryBody,
  formatSellerPickupDateTime,
  shouldSendSellerOrderPush,
  withSellerStorePrefix,
} from "./seller-order-notification-copy.util";

describe("shouldSendSellerOrderPush", () => {
  it("새 예약신청(주문 생성)은 푸시를 보낸다", () => {
    expect(
      shouldSendSellerOrderPush({
        source: ORDER_STATUS_TRANSITION_SOURCE.ORDER_CREATE,
        toStatus: OrderStatus.RESERVATION_REQUESTED,
      }),
    ).toBe(true);
  });

  it("손님이 한 일(입금완료·취소·환불 요청)은 푸시를 보낸다", () => {
    expect(
      shouldSendSellerOrderPush({
        source: ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION,
        toStatus: OrderStatus.PAYMENT_COMPLETED,
      }),
    ).toBe(true);
  });

  it("입금 기한 만료 자동 취소와 관리자 변경은 푸시를 보낸다", () => {
    expect(
      shouldSendSellerOrderPush({
        source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
        toStatus: OrderStatus.CANCEL_COMPLETED,
      }),
    ).toBe(true);
    expect(
      shouldSendSellerOrderPush({
        source: ORDER_STATUS_TRANSITION_SOURCE.ADMIN_STATUS_UPDATE,
        toStatus: OrderStatus.CANCEL_REFUND_PENDING,
      }),
    ).toBe(true);
  });

  it("픽업 시각이 되어 픽업대기로 바뀐 것은 푸시를 보내지 않는다(아침 요약이 대신)", () => {
    expect(
      shouldSendSellerOrderPush({
        source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
        toStatus: OrderStatus.PICKUP_PENDING,
      }),
    ).toBe(false);
    expect(
      shouldSendSellerOrderPush({
        source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC,
        toStatus: OrderStatus.PICKUP_PENDING,
      }),
    ).toBe(false);
  });

  it("판매자가 직접 바꾼 상태는 푸시를 보내지 않는다", () => {
    expect(
      shouldSendSellerOrderPush({
        source: ORDER_STATUS_TRANSITION_SOURCE.SELLER_STATUS_UPDATE,
        toStatus: OrderStatus.CONFIRMED,
      }),
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
      title: "새 예약 신청이 왔어요",
      body: "손님이 예약을 신청했어요. 예약을 확인해 주세요.",
    });
  });

  it("입금완료 문구", () => {
    expect(
      buildSellerOrderNotificationCopy({
        fromStatus: OrderStatus.PAYMENT_PENDING,
        toStatus: OrderStatus.PAYMENT_COMPLETED,
        source: ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION,
      })?.title,
    ).toBe("손님이 입금했어요");
  });
});

describe("formatSellerPickupDateTime", () => {
  it('Asia/Seoul 기준 "11월 12일(목) 14:00" 모양으로 쓴다', () => {
    expect(formatSellerPickupDateTime(new Date("2026-11-12T05:00:00.000Z"))).toBe(
      "11월 12일(목) 14:00",
    );
  });

  it("자정을 넘긴 한국 시간도 맞게 쓴다", () => {
    expect(formatSellerPickupDateTime(new Date("2026-11-12T15:30:00.000Z"))).toBe(
      "11월 13일(금) 00:30",
    );
  });
});

describe("buildSellerOrderSummaryBody", () => {
  const pickupDate = new Date("2026-11-12T05:00:00.000Z");

  it("한 개면 상품 이름 · 픽업 일시", () => {
    expect(
      buildSellerOrderSummaryBody({ productName: "무화과 케이크", totalQuantity: 1, pickupDate }),
    ).toBe("무화과 케이크 · 11월 12일(목) 14:00 픽업");
  });

  it("여러 개면 개수를 붙인다", () => {
    expect(
      buildSellerOrderSummaryBody({
        productName: "레터링 미니 케이크",
        totalQuantity: 2,
        pickupDate,
      }),
    ).toBe("레터링 미니 케이크 2개 · 11월 12일(목) 14:00 픽업");
  });

  it("픽업 일시가 없으면 상품만, 상품 이름이 없으면 null", () => {
    expect(
      buildSellerOrderSummaryBody({
        productName: "무화과 케이크",
        totalQuantity: 1,
        pickupDate: null,
      }),
    ).toBe("무화과 케이크");
    expect(
      buildSellerOrderSummaryBody({ productName: "  ", totalQuantity: 1, pickupDate }),
    ).toBeNull();
  });
});

describe("withSellerStorePrefix", () => {
  it("스토어가 하나면 제목 그대로, 둘 이상이면 [스토어 이름]을 붙인다", () => {
    expect(withSellerStorePrefix("새 예약 신청이 왔어요", "달콤케이크", 1)).toBe(
      "새 예약 신청이 왔어요",
    );
    expect(withSellerStorePrefix("새 예약 신청이 왔어요", "달콤케이크 2호점", 2)).toBe(
      "[달콤케이크 2호점] 새 예약 신청이 왔어요",
    );
  });
});
