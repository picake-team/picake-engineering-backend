import { describe, expect, it, vi } from "vitest";

import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";

// 운영자가 되돌린 경우의 템플릿은 카카오 검수 승인 뒤에 ID가 들어가므로, 테스트에서는 ID가 있다고 두고 확인한다
vi.mock(
  "@apps/backend/modules/notification/constants/user-order-alimtalk.constants",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@apps/backend/modules/notification/constants/user-order-alimtalk.constants")
      >();
    return {
      ...actual,
      USER_ORDER_ALIMTALK_TEMPLATE_IDS: {
        ...actual.USER_ORDER_ALIMTALK_TEMPLATE_IDS,
        CANCEL_REFUND_PENDING_BY_ADMIN: "TEST_ADMIN_REVERT",
      },
    };
  },
);

import { USER_ORDER_ALIMTALK_TEMPLATE_IDS } from "@apps/backend/modules/notification/constants/user-order-alimtalk.constants";
import {
  buildUserOrderAlimtalkPayload,
  type UserOrderAlimtalkOrderInfo,
} from "./user-order-alimtalk.util";

const order: UserOrderAlimtalkOrderInfo = {
  publicUserDomain: "https://picakes.com",
  orderId: "order1",
  orderNumber: "20261111-0001",
  storeName: "달콤케이크",
  consumerName: "홍길동",
  reservationContactName: "홍길동",
  productName: "레터링 케이크",
  totalPrice: 32000,
  pickupDate: new Date("2026-12-15T05:00:00.000Z"),
  pickupRoadAddress: "서울 마포구 양화로 1",
  pickupAddress: null,
  pickupDetailAddress: null,
  pickupLatitude: null,
  pickupLongitude: null,
  paymentPendingDeadlineAt: null,
  storeBankName: null,
  storeBankAccountNumber: null,
  storeAccountHolderName: null,
  sellerCancelReason: null,
  sellerCancelRefundPendingReason: "재료 소진",
};

const toRefundPending = (source: string) =>
  buildUserOrderAlimtalkPayload(
    {
      fromStatus: OrderStatus.CANCEL_COMPLETED,
      toStatus: OrderStatus.CANCEL_REFUND_PENDING,
      source,
    } as never,
    order,
  );

describe("취소환불대기 알림톡", () => {
  it("운영자가 취소완료를 되돌리면(입금 확인) 운영자용 환불 진행 안내를 보낸다", () => {
    const payload = toRefundPending(ORDER_STATUS_TRANSITION_SOURCE.ADMIN_STATUS_UPDATE);
    expect(payload?.templateId).toBe("TEST_ADMIN_REVERT");
    expect(payload?.variables["#{결제금액}"]).toBe("32,000원");
    expect(payload?.variables["#{주문번호}"]).toBe("20261111-0001");
  });

  it("판매자가 바꾸면 지금처럼 판매자 환불 진행 안내(템플릿8)", () => {
    const payload = toRefundPending(ORDER_STATUS_TRANSITION_SOURCE.SELLER_STATUS_UPDATE);
    expect(payload?.templateId).toBe(
      USER_ORDER_ALIMTALK_TEMPLATE_IDS.CANCEL_REFUND_PENDING_BY_SELLER,
    );
    expect(payload?.variables["#{취소사유}"]).toBe("재료 소진");
  });

  it("손님이 직접 환불을 요청하면 보내지 않는다(본인이 한 일)", () => {
    expect(toRefundPending(ORDER_STATUS_TRANSITION_SOURCE.USER_ACTION)).toBeNull();
  });
});
