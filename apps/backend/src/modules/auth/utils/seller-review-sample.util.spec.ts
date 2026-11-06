import { describe, expect, it } from "vitest";

import { OrderStatus } from "@apps/backend/infra/database/prisma/generated/client";
import {
  REVIEW_SAMPLE_PRODUCTS,
  buildReviewProductCreateData,
  buildReviewSampleOrders,
  buildReviewStoreCreateData,
  kstAt,
} from "@apps/backend/modules/auth/utils/seller-review-sample.util";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";

const PRODUCTS = REVIEW_SAMPLE_PRODUCTS.map((sample, index) => ({
  id: `product-${index + 1}`,
  name: sample.name,
  salePrice: sample.salePrice,
  images: [],
  productNumber: sample.productNumber,
}));

function build(now: Date, products = PRODUCTS) {
  return buildReviewSampleOrders({
    now,
    storeId: "store-1",
    storeName: "픽케이크 심사용 가게",
    consumerId: "consumer-1",
    products,
    randomSuffix: () => "A1B",
  });
}

describe("kstAt", () => {
  it("한국 날짜 기준으로 며칠 뒤 몇 시를 만든다(UTC로는 9시간 앞)", () => {
    // 한국 2026-11-07 00:30 (UTC 11-06 15:30)
    const now = new Date("2026-11-06T15:30:00.000Z");
    expect(kstAt(now, 0, 18).toISOString()).toBe("2026-11-07T09:00:00.000Z");
    expect(kstAt(now, 1, 11).toISOString()).toBe("2026-11-08T02:00:00.000Z");
    expect(kstAt(now, -2, 15).toISOString()).toBe("2026-11-05T06:00:00.000Z");
  });
});

describe("buildReviewStoreCreateData / buildReviewProductCreateData", () => {
  it("심사용 가게는 손님 목록에서 빠지는 표시값과 영업 시간·환불 규정·정산 계좌를 갖는다", () => {
    const data = buildReviewStoreCreateData("seller-1");
    expect(data.businessNo).toBe(REVIEW_STORE_BUSINESS_NO);
    expect(data.sellerId).toBe("seller-1");
    expect(data.standardOpenTime).toBe("10:00");
    expect(data.standardCloseTime).toBe("20:00");
    expect(data.bankName).toBeTruthy();
    expect((data.refundCancellationPolicy as { rules: unknown[] }).rules).toHaveLength(3);
  });

  it("예시 상품은 판매 중·보이기이고 다시 찾을 상품번호를 갖는다", () => {
    const data = buildReviewProductCreateData("store-1", REVIEW_SAMPLE_PRODUCTS[0]!);
    expect(data.salesStatus).toBe("ENABLE");
    expect(data.visibilityStatus).toBe("ENABLE");
    expect(data.productNumber).toBe("REVIEW-SAMPLE-1");
  });
});

describe("buildReviewSampleOrders", () => {
  const now = new Date("2026-11-07T01:00:00.000Z"); // 한국 오전 10시

  it("상태별 예시 주문 8건을 만든다", () => {
    const orders = build(now);
    expect(orders.map((order) => order.orderStatus)).toEqual([
      OrderStatus.RESERVATION_REQUESTED,
      OrderStatus.PAYMENT_PENDING,
      OrderStatus.PAYMENT_COMPLETED,
      OrderStatus.CONFIRMED,
      OrderStatus.PICKUP_PENDING,
      OrderStatus.CANCEL_REFUND_PENDING,
      OrderStatus.PICKUP_COMPLETED,
      OrderStatus.CANCEL_COMPLETED,
    ]);
  });

  it("주문 번호는 실제 형식을 따르되 겹치지 않는 R 번호를 쓴다", () => {
    const numbers = build(now).map((order) => order.orderNumber);
    expect(new Set(numbers).size).toBe(8);
    for (const number of numbers) {
      expect(number).toMatch(/^ORD-20261107-R0[1-8]A1B$/);
    }
  });

  it("금액은 상품 가격 + 사이즈 + 옵션이고 옵션 스냅샷을 주문 항목에 남긴다", () => {
    const first = build(now)[0]!;
    // 딸기 생크림 32,000 + 1호 8,000 + 긴 초 0
    expect(first.totalPrice).toBe(40000);
    const item = (first.orderItems as { create: Record<string, unknown>[] }).create[0]!;
    expect(item.itemPrice).toBe(40000);
    expect(item.sizeDisplayName).toBe("1호");
    expect(item.letteringMessage).toBe("생일 축하해");
    expect(item.selectedOptions).toEqual([
      {
        optionId: "review-opt-lettering",
        type: "TEXT",
        name: "레터링 문구",
        text: "생일 축하해",
        price: 0,
      },
      {
        optionId: "review-opt-candle",
        type: "SINGLE_SELECT",
        name: "초",
        choices: [{ id: "review-choice-candle-long", label: "긴 초", price: 0 }],
        price: 0,
      },
    ]);
  });

  it("손님 알림톡이 나가지 않게 예약 연락처를 비운다", () => {
    for (const order of build(now)) {
      expect(order.reservationPhone).toBeNull();
    }
  });

  it("입금대기는 입금 마감이 있고, 예약신청은 입금 정보가 없으며, 입금 뒤 상태는 입금자명이 있다", () => {
    const [requested, pending, completed] = build(now);
    expect(requested!.paymentPendingAt).toBeNull();
    expect(requested!.depositorName).toBeNull();
    expect(pending!.paymentPendingDeadlineAt).toBeInstanceOf(Date);
    expect((pending!.paymentPendingDeadlineAt as Date).getTime()).toBeGreaterThan(now.getTime());
    expect(completed!.depositorName).toBe("예시손님");
  });

  it("취소환불대기는 환불 사유·계좌를, 취소완료는 손님 취소 사유를 갖는다", () => {
    const orders = build(now);
    const refund = orders.find((order) => order.orderStatus === OrderStatus.CANCEL_REFUND_PENDING)!;
    expect(refund.refundRequestReason).toBeTruthy();
    expect(refund.refundBankName).toBeTruthy();
    expect(refund.refundAccountHolderName).toBeTruthy();
    const canceled = orders.find((order) => order.orderStatus === OrderStatus.CANCEL_COMPLETED)!;
    expect(canceled.userCancelReason).toBeTruthy();
  });

  it("픽업대기는 오후 5시 전이면 오늘 저녁, 뒤면 내일 오전 픽업", () => {
    const pickupOf = (at: Date) =>
      (
        build(at).find((order) => order.orderStatus === OrderStatus.PICKUP_PENDING)!
          .pickupDate as Date
      ).toISOString();
    // 한국 오전 10시 → 오늘 18시
    expect(pickupOf(now)).toBe("2026-11-07T09:00:00.000Z");
    // 한국 오후 9시 → 내일 11시
    expect(pickupOf(new Date("2026-11-07T12:00:00.000Z"))).toBe("2026-11-08T02:00:00.000Z");
  });

  it("지난 주문(픽업완료·취소완료)은 픽업일이 지났고, 나머지는 앞으로다", () => {
    const pastStatuses: OrderStatus[] = [
      OrderStatus.PICKUP_COMPLETED,
      OrderStatus.CANCEL_COMPLETED,
    ];
    for (const order of build(now)) {
      const past = pastStatuses.includes(order.orderStatus as OrderStatus);
      expect((order.pickupDate as Date).getTime() < now.getTime()).toBe(past);
    }
  });

  it("심사관이 지운 상품의 주문은 만들지 않는다", () => {
    const orders = build(now, PRODUCTS.slice(0, 1));
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((order) => order.productId === "product-1")).toBe(true);
  });
});
