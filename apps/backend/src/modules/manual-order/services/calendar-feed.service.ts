import { randomBytes } from "crypto";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import {
  ManualOrderSource,
  OrderStatus,
} from "@apps/backend/infra/database/prisma/generated/client";
import { API_PREFIX } from "@apps/backend/common/constants/app.constants";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import {
  koreaCalendarDayEndUtc,
  koreaCalendarDayStartUtc,
  koreaCalendarYmd,
} from "@apps/backend/modules/order/utils/order-list-query.util";
import {
  CALENDAR_FEED,
  CALENDAR_FEED_ERROR_MESSAGES,
  MANUAL_ORDER_ERROR_MESSAGES,
} from "@apps/backend/modules/manual-order/constants/manual-order.constants";
import { CalendarFeedDto } from "@apps/backend/modules/manual-order/dto/manual-order.dto";
import {
  buildCalendarIcs,
  buildEventSummary,
  type CalendarFeedEvent,
} from "@apps/backend/modules/manual-order/utils/calendar-feed-ics.util";
import {
  addDaysToYmd,
  utcToKstHm,
} from "@apps/backend/modules/manual-order/utils/manual-order-date.util";

export const MANUAL_ORDER_SOURCE_LABEL: Record<ManualOrderSource, string> = {
  KAKAO: "카톡",
  INSTAGRAM: "인스타",
  PHONE: "전화",
  NAVER: "네이버",
  OTHER: "기타",
};

/** 내보내는 Picake 주문: 취소·노쇼는 뺀다 */
const FEED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.RESERVATION_REQUESTED,
  OrderStatus.PAYMENT_PENDING,
  OrderStatus.PAYMENT_COMPLETED,
  OrderStatus.CONFIRMED,
  OrderStatus.PICKUP_PENDING,
  OrderStatus.PICKUP_COMPLETED,
];

const FEED_PENDING_LABEL: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.RESERVATION_REQUESTED]: "예약신청(아직 받지 않음)",
  [OrderStatus.PAYMENT_PENDING]: "입금 전",
};

export const CALENDAR_FEED_PATH_PREFIX = `${API_PREFIX}/${AUDIENCE.SELLER}/calendar-feeds`;

/** 주소의 비밀 값: 영문·숫자·-·_ 32자 */
export function newCalendarFeedToken(): string {
  return randomBytes(CALENDAR_FEED.TOKEN_BYTES).toString("base64url");
}

/**
 * 다른 캘린더로 내보내기(기획 I-42): 아이폰·구글 캘린더가 구독하는 ics 주소.
 * 주소의 비밀 값을 아는 사람은 로그인 없이 일정을 읽으므로 손님 이름은 기본으로 가린다. 새로 만들면(reset) 옛 주소는 끊긴다 — 화면 버튼은 운영자가 뺐고(11-17) API만 남김.
 * Picake 예약(취소·노쇼 빼고)과 직접 적은 주문을 같이 내보낸다. 지난 60일부터 앞으로 1년.
 */
@Injectable()
export class CalendarFeedService {
  constructor(private readonly prisma: PrismaService) {}

  /** 주소를 보여 준다. 처음이면 만든다(같은 순간 두 번 불러도 주소는 하나 — 먼저 받은 주소가 끊기지 않게) */
  async get(sellerId: string, storeId: string): Promise<CalendarFeedDto> {
    const store = await this.findOwned(sellerId, storeId);
    if (store.calendarFeedToken) {
      return this.toDto(store.calendarFeedToken, store.calendarFeedShowCustomer);
    }
    await this.prisma.store.updateMany({
      where: { id: storeId, calendarFeedToken: null },
      data: { calendarFeedToken: newCalendarFeedToken() },
    });
    const created = await this.findOwned(sellerId, storeId);
    return this.toDto(created.calendarFeedToken!, created.calendarFeedShowCustomer);
  }

  /** 새 주소를 만든다(옛 주소는 끊김) */
  async reset(sellerId: string, storeId: string): Promise<CalendarFeedDto> {
    await this.findOwned(sellerId, storeId);
    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: { calendarFeedToken: newCalendarFeedToken() },
      select: { calendarFeedToken: true, calendarFeedShowCustomer: true },
    });
    return this.toDto(updated.calendarFeedToken!, updated.calendarFeedShowCustomer);
  }

  async updateSettings(
    sellerId: string,
    storeId: string,
    showCustomerName: boolean,
  ): Promise<CalendarFeedDto> {
    const store = await this.findOwned(sellerId, storeId);
    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        calendarFeedShowCustomer: showCustomerName,
        calendarFeedToken: store.calendarFeedToken ?? newCalendarFeedToken(),
      },
      select: { calendarFeedToken: true, calendarFeedShowCustomer: true },
    });
    return this.toDto(updated.calendarFeedToken!, updated.calendarFeedShowCustomer);
  }

  /** 구독 주소로 온 요청에 줄 ics. 없는 주소·탈퇴하거나 정지된 사장님이면 404 */
  async buildIcs(token: string, now: Date = new Date()): Promise<string> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      throw new NotFoundException(CALENDAR_FEED_ERROR_MESSAGES.NOT_FOUND);
    }
    const store = await this.prisma.store.findUnique({
      where: { calendarFeedToken: token },
      select: {
        id: true,
        name: true,
        calendarFeedShowCustomer: true,
        seller: { select: { withdrawnAt: true, isActive: true } },
      },
    });
    // 정지된 사장님은 로그인을 못 해 주소를 끊을 수도 없으니 닫는다(계정이 털려 정지한 경우)
    if (!store || store.seller.withdrawnAt || !store.seller.isActive) {
      throw new NotFoundException(CALENDAR_FEED_ERROR_MESSAGES.NOT_FOUND);
    }

    const today = koreaCalendarYmd(now);
    const from = addDaysToYmd(today, -CALENDAR_FEED.PAST_DAYS);
    const to = addDaysToYmd(today, CALENDAR_FEED.FUTURE_DAYS);
    const showCustomerName = store.calendarFeedShowCustomer;

    const [orders, manualOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          storeId: store.id,
          orderStatus: { in: FEED_ORDER_STATUSES },
          pickupDate: { gte: koreaCalendarDayStartUtc(from), lte: koreaCalendarDayEndUtc(to) },
        },
        select: {
          id: true,
          pickupDate: true,
          productName: true,
          reservationContactName: true,
          orderStatus: true,
          updatedAt: true,
        },
      }),
      this.prisma.manualOrder.findMany({
        where: { storeId: store.id, pickupDate: { gte: from, lte: to } },
        select: {
          id: true,
          pickupDate: true,
          pickupTime: true,
          cakeName: true,
          source: true,
          customerName: true,
          paid: true,
          updatedAt: true,
        },
      }),
    ]);

    const events: CalendarFeedEvent[] = [];
    for (const order of orders) {
      if (!order.pickupDate) continue;
      events.push({
        uid: `order-${order.id}@picakes.com`,
        date: koreaCalendarYmd(order.pickupDate),
        time: utcToKstHm(order.pickupDate),
        summary: buildEventSummary({
          title: order.productName ?? "견적 주문",
          sourceLabel: "Picake",
          customerName: order.reservationContactName,
          showCustomerName,
        }),
        // 아직 받지 않은 예약신청·입금 전은 다른 캘린더에서도 확정과 나눠 보이게
        description: FEED_PENDING_LABEL[order.orderStatus] ?? null,
        updatedAt: order.updatedAt,
      });
    }
    for (const row of manualOrders) {
      events.push({
        uid: `manual-${row.id}@picakes.com`,
        date: row.pickupDate,
        time: row.pickupTime,
        summary: buildEventSummary({
          title: row.cakeName,
          sourceLabel: MANUAL_ORDER_SOURCE_LABEL[row.source],
          customerName: row.customerName,
          showCustomerName,
        }),
        description: row.paid === false ? "입금 전" : null,
        updatedAt: row.updatedAt,
      });
    }

    return buildCalendarIcs({ calendarName: `픽케이크 ${store.name}`, events, now });
  }

  private async findOwned(sellerId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, sellerId },
      select: { id: true, calendarFeedToken: true, calendarFeedShowCustomer: true },
    });
    if (!store) throw new ForbiddenException(MANUAL_ORDER_ERROR_MESSAGES.STORE_NOT_OWNED);
    return store;
  }

  private toDto(token: string, showCustomerName: boolean): CalendarFeedDto {
    return { path: `${CALENDAR_FEED_PATH_PREFIX}/${token}.ics`, showCustomerName };
  }
}
