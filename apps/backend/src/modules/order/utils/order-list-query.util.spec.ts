import { describe, expect, it } from "vitest";

import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import {
  OrderSortBy,
  OrderStatus,
  OrderType,
} from "@apps/backend/modules/order/constants/order.constants";

import {
  buildOrderKeywordCondition,
  buildOrderOrderBy,
  koreaCalendarYmd,
  mergeOrderPickupDateConditions,
} from "./order-list-query.util";

const FINISHED_STATUSES = [
  OrderStatus.PICKUP_COMPLETED,
  OrderStatus.CANCEL_COMPLETED,
  OrderStatus.CANCEL_REFUND_COMPLETED,
  OrderStatus.NO_SHOW,
];

describe("buildOrderOrderBy", () => {
  it("픽업 가까운 순은 픽업 일시 오름차순이고 픽업 일시가 없는 주문은 맨 뒤다", () => {
    expect(buildOrderOrderBy(OrderSortBy.PICKUP_ASC)).toEqual([
      { pickupDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ]);
  });

  it("픽업 최근 순은 픽업 일시 내림차순이고 픽업 일시가 없는 주문은 맨 뒤다", () => {
    expect(buildOrderOrderBy(OrderSortBy.PICKUP_DESC)).toEqual([
      { pickupDate: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ]);
  });

  it("기존 정렬(최신순)은 그대로다", () => {
    expect(buildOrderOrderBy(OrderSortBy.LATEST)).toEqual([{ createdAt: "desc" }]);
  });
});

describe("mergeOrderPickupDateConditions", () => {
  it("FINISHED는 끝난 주문 네 상태만 고르고 픽업 일시 조건은 두지 않는다", () => {
    const where: Prisma.OrderWhereInput = { storeId: "store-1" };
    mergeOrderPickupDateConditions(where, { type: OrderType.FINISHED });

    expect(where).toEqual({
      storeId: "store-1",
      AND: [{ orderStatus: { in: FINISHED_STATUSES } }],
    });
  });

  it("FINISHED와 픽업일 구간을 함께 주면 둘 다 AND로 걸린다", () => {
    const where: Prisma.OrderWhereInput = {};
    mergeOrderPickupDateConditions(where, {
      type: OrderType.FINISHED,
      pickupStartDate: "2026-11-01",
      pickupEndDate: "2026-11-30",
    });

    expect(where.AND).toEqual([
      { orderStatus: { in: FINISHED_STATUSES } },
      {
        pickupDate: {
          gte: new Date("2026-11-01T00:00:00.000+09:00"),
          lte: new Date("2026-11-30T23:59:59.999+09:00"),
        },
      },
    ]);
  });

  it("PAST는 지금처럼 픽업 일시가 지난 주문도 포함한다(끝난 주문만이 아님)", () => {
    const where: Prisma.OrderWhereInput = {};
    mergeOrderPickupDateConditions(where, { type: OrderType.PAST });

    const and = where.AND as Prisma.OrderWhereInput[];
    expect(and).toHaveLength(1);
    expect(and[0]?.OR).toEqual([
      { pickupDate: { lt: expect.any(Date) } },
      { orderStatus: { in: FINISHED_STATUSES } },
    ]);
  });

  it("type이 없으면 조건을 더하지 않는다", () => {
    const where: Prisma.OrderWhereInput = { storeId: "store-1" };
    mergeOrderPickupDateConditions(where, {});

    expect(where).toEqual({ storeId: "store-1" });
  });
});

describe("buildOrderKeywordCondition", () => {
  it("빈 검색어면 조건이 없다", () => {
    expect(buildOrderKeywordCondition(undefined)).toBeNull();
    expect(buildOrderKeywordCondition("  ")).toBeNull();
  });

  it("글자 검색어는 주문번호·상품명·예약자 이름에서 찾는다", () => {
    expect(buildOrderKeywordCondition(" 하늘 ")).toEqual({
      OR: [
        { orderNumber: { contains: "하늘", mode: "insensitive" } },
        { productName: { contains: "하늘", mode: "insensitive" } },
        { reservationContactName: { contains: "하늘", mode: "insensitive" } },
      ],
    });
  });

  it("숫자 4자리 이상이면 하이픈·공백을 빼고 연락처에서도 찾는다", () => {
    expect(buildOrderKeywordCondition("010-1234 5678")?.OR).toContainEqual({
      reservationPhone: { contains: "01012345678" },
    });
    expect(buildOrderKeywordCondition("5678")?.OR).toContainEqual({
      reservationPhone: { contains: "5678" },
    });
    expect(buildOrderKeywordCondition("567")?.OR).toHaveLength(3);
  });
});

describe("koreaCalendarYmd", () => {
  it("한국 자정~아침 9시(UTC로는 전날)도 한국 날짜를 준다", () => {
    expect(koreaCalendarYmd(new Date("2026-11-12T15:00:00.000Z"))).toBe("2026-11-13"); // 11-13 00:00 KST
    expect(koreaCalendarYmd(new Date("2026-11-12T23:59:59.999Z"))).toBe("2026-11-13"); // 11-13 08:59 KST
    expect(koreaCalendarYmd(new Date("2026-11-12T14:59:59.999Z"))).toBe("2026-11-12"); // 11-12 23:59 KST
    expect(koreaCalendarYmd(new Date("2026-12-31T15:00:00.000Z"))).toBe("2027-01-01");
  });
});
