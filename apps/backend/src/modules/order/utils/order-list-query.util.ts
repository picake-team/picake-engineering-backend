import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import {
  OrderSortBy,
  OrderStatus,
  OrderType,
} from "@apps/backend/modules/order/constants/order.constants";

/** 목록 `type`(UPCOMING/PAST) 분류 시 픽업 일시와 무관하게 항상 PAST(지난 예약)로만 취급하는 상태 */
const ORDER_STATUSES_ALWAYS_PAST_TAB: OrderStatus[] = [
  OrderStatus.PICKUP_COMPLETED,
  OrderStatus.CANCEL_COMPLETED,
  OrderStatus.CANCEL_REFUND_COMPLETED,
  OrderStatus.NO_SHOW,
];

const KOREA_OFFSET = "+09:00";

/** YYYY-MM-DD (Asia/Seoul 달력일) → 해당 일 00:00:00.000 KST 의 UTC 시각 */
export function koreaCalendarDayStartUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000${KOREA_OFFSET}`);
}

/** YYYY-MM-DD (Asia/Seoul 달력일) → 해당 일 23:59:59.999 KST 의 UTC 시각 */
export function koreaCalendarDayEndUtc(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999${KOREA_OFFSET}`);
}

/**
 * `type`(UPCOMING/PAST/FINISHED) 및 픽업일 달력 구간 필터를 `where`에 반영.
 * 둘 다 있으면 AND로 결합해 `pickupDate` 조건이 덮어쓰이지 않게 함.
 *
 * 픽업완료·취소완료·취소환불완료·노쇼는 픽업 일시와 무관하게 항상 PAST(지난 예약)로만 분류되며,
 * UPCOMING(픽업 예정) 목록에서는 제외된다.
 * FINISHED(끝난 주문)는 이 네 상태만 고른다. PAST와 달리 픽업 일시가 지났어도 아직 처리하지 않은
 * 주문(예: 픽업대기)은 넣지 않는다(판매자 앱에서는 그런 주문이 "처리할 것" 탭에 있어야 함).
 */
export function mergeOrderPickupDateConditions(
  where: Prisma.OrderWhereInput,
  opts: {
    type?: OrderType;
    pickupStartDate?: string;
    pickupEndDate?: string;
  },
): void {
  const { type, pickupStartDate, pickupEndDate } = opts;
  const parts: Prisma.OrderWhereInput[] = [];
  const now = new Date();

  if (type === OrderType.UPCOMING) {
    parts.push({
      AND: [
        { pickupDate: { gte: now } },
        { orderStatus: { notIn: ORDER_STATUSES_ALWAYS_PAST_TAB } },
      ],
    });
  } else if (type === OrderType.PAST) {
    parts.push({
      OR: [{ pickupDate: { lt: now } }, { orderStatus: { in: ORDER_STATUSES_ALWAYS_PAST_TAB } }],
    });
  } else if (type === OrderType.FINISHED) {
    parts.push({ orderStatus: { in: ORDER_STATUSES_ALWAYS_PAST_TAB } });
  }

  if (pickupStartDate || pickupEndDate) {
    const range: Prisma.DateTimeNullableFilter = {};
    if (pickupStartDate) {
      range.gte = koreaCalendarDayStartUtc(pickupStartDate);
    }
    if (pickupEndDate) {
      range.lte = koreaCalendarDayEndUtc(pickupEndDate);
    }
    parts.push({ pickupDate: range });
  }

  if (parts.length === 0) {
    return;
  }

  if (parts.length === 1) {
    const p = parts[0]!;
    if ("pickupDate" in p && !("AND" in p) && !("OR" in p)) {
      where.pickupDate = p.pickupDate;
      return;
    }
    const existing = where.AND;
    const prefix = Array.isArray(existing) ? existing : existing ? [existing] : [];
    where.AND = [...prefix, p];
    return;
  }

  const existing = where.AND;
  const prefix = Array.isArray(existing) ? existing : existing ? [existing] : [];
  where.AND = [...prefix, ...parts];
}

/**
 * 주문 목록 조회 시 공통으로 사용하는 정렬 조건
 * 사용자 마이페이지 주문 목록 / 판매자 주문 목록에서 동일한 정렬 규칙 적용
 */
export function buildOrderOrderBy(sortBy: OrderSortBy): Prisma.OrderOrderByWithRelationInput[] {
  switch (sortBy) {
    case OrderSortBy.LATEST:
      return [{ createdAt: "desc" }];
    case OrderSortBy.OLDEST:
      return [{ createdAt: "asc" }];
    case OrderSortBy.PRICE_DESC:
      return [{ totalPrice: "desc" }, { createdAt: "desc" }];
    case OrderSortBy.PRICE_ASC:
      return [{ totalPrice: "asc" }, { createdAt: "desc" }];
    // 픽업 일시가 없는 주문은 어느 쪽이든 맨 뒤로
    case OrderSortBy.PICKUP_ASC:
      return [{ pickupDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
    case OrderSortBy.PICKUP_DESC:
      return [{ pickupDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    default:
      return [{ createdAt: "desc" }];
  }
}
