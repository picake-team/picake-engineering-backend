import { ManualOrderSource } from "@apps/backend/infra/database/prisma/generated/client";
import {
  SELLER_ORDER_STATISTICS_WEEKDAY_INDEX_ORDER,
  SELLER_ORDER_STATISTICS_WEEKDAY_LABELS,
} from "@apps/backend/modules/statistics/seller/constants/seller-order-statistics.constants";
import type { SellerManualOrderStatisticsDto } from "@apps/backend/modules/statistics/seller/dto/seller-order-statistics-overview.dto";
import { ymdWeekday } from "@apps/backend/modules/manual-order/utils/manual-order-date.util";

/** 받은 곳 나열 순서(화면은 많은 순으로 다시 정렬) */
const SOURCE_ORDER: ManualOrderSource[] = [
  ManualOrderSource.KAKAO,
  ManualOrderSource.INSTAGRAM,
  ManualOrderSource.PHONE,
  ManualOrderSource.NAVER,
  ManualOrderSource.OTHER,
];

export interface ManualOrderStatRow {
  pickupDate: string;
  pickupTime: string | null;
  price: number | null;
  source: ManualOrderSource;
}

/**
 * 직접 적은 주문(기획 I-42) 통계. 픽업 날이 기간 안이고 오늘까지 지난 주문을 픽업한 것으로 센다(부르는 쪽이 거름).
 * 매출은 금액을 적은 주문만 더한다. 요일·시간대는 픽업 날·시각 기준(시각을 적지 않은 주문은 시간대에서 뺌).
 */
export function buildManualOrderStatistics(
  rows: ManualOrderStatRow[],
): SellerManualOrderStatisticsDto {
  const bySource = new Map<ManualOrderSource, { sales: number; orders: number }>();
  const weekdaySales = Array.from({ length: 7 }, () => 0);
  const weekdayOrders = Array.from({ length: 7 }, () => 0);
  const hourly = Array.from({ length: 24 }, () => 0);
  let totalSales = 0;

  for (const row of rows) {
    const price = row.price ?? 0;
    totalSales += price;
    const source = bySource.get(row.source) ?? { sales: 0, orders: 0 };
    source.sales += price;
    source.orders += 1;
    bySource.set(row.source, source);

    const weekday = ymdWeekday(row.pickupDate);
    weekdaySales[weekday] += price;
    weekdayOrders[weekday] += 1;
    if (row.pickupTime) {
      const hour = Number(row.pickupTime.slice(0, 2));
      if (hour >= 0 && hour < 24) hourly[hour] += 1;
    }
  }

  const weekdayRows = (values: number[]) =>
    SELLER_ORDER_STATISTICS_WEEKDAY_INDEX_ORDER.map((d) => ({
      weekday: d,
      label: `${SELLER_ORDER_STATISTICS_WEEKDAY_LABELS[d]}요일`,
      total: values[d],
    }));

  return {
    totalSales,
    totalOrders: rows.length,
    bySource: SOURCE_ORDER.filter((s) => bySource.has(s)).map((s) => ({
      source: s,
      sales: bySource.get(s)!.sales,
      orders: bySource.get(s)!.orders,
    })),
    weekdayPickupSales: weekdayRows(weekdaySales),
    weekdayPickupOrders: weekdayRows(weekdayOrders),
    hourlyPickupOrders: hourly.map((count, hour) => ({ hour, count })),
  };
}
