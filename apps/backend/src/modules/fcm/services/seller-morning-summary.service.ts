import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { NotificationAppSurface } from "@apps/backend/infra/database/prisma/generated/client";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import {
  koreaCalendarDayEndUtc,
  koreaCalendarDayStartUtc,
} from "@apps/backend/modules/order/utils/order-list-query.util";
import { withSellerStorePrefix } from "@apps/backend/modules/notification/utils/seller-order-notification-copy.util";
import { SellerFcmPushService } from "@apps/backend/modules/fcm/services/seller-fcm-push.service";
import {
  FCM_ANDROID_CHANNEL_ID,
  FCM_PUSH_TYPE,
  buildSellerHomePath,
} from "@apps/backend/modules/fcm/types/fcm-push.types";

/** 아침 요약에 세는 주문: 그날 아직 픽업 전인 주문(취소된 주문과 이미 끝난 주문은 뺌) */
export const MORNING_SUMMARY_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.RESERVATION_REQUESTED,
  OrderStatus.PAYMENT_PENDING,
  OrderStatus.PAYMENT_COMPLETED,
  OrderStatus.CONFIRMED,
  OrderStatus.PICKUP_PENDING,
];

/** 보내는 시간대(Asia/Seoul). 8시에 보내고, 서버가 늦게 떠도 오전 중에만 보낸다 */
export const MORNING_SUMMARY_START_HOUR_KST = 8;
export const MORNING_SUMMARY_END_HOUR_KST = 11;

const KST_TIME_ZONE = "Asia/Seoul";

/** Asia/Seoul 기준 날짜(YYYY-MM-DD)와 시(0~23) */
export function kstClock(now: Date): { dateKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** "11:00" (Asia/Seoul) */
export function formatKstTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** 아침 요약 문구: "오늘 픽업 2건" / "첫 픽업 11:00". 스토어가 여럿이면 제목 앞에 [스토어 이름] (기획 I-48) */
export function buildMorningSummaryCopy(params: {
  pickupCount: number;
  firstPickupAt: Date;
  storeName: string;
  sellerStoreCount: number;
}): { title: string; body: string } {
  return {
    title: withSellerStorePrefix(
      `오늘 픽업 ${params.pickupCount}건`,
      params.storeName,
      params.sellerStoreCount,
    ),
    body: `첫 픽업 ${formatKstTime(params.firstPickupAt)}`,
  };
}

/**
 * 판매자 앱 아침 요약 휴대폰 알림(기획 I-48).
 *
 * 매일 아침 8시부터, 알림을 받을 휴대폰이 있는 사장님의 스토어마다 그날 픽업할 주문이 있으면
 * "오늘 픽업 n건 / 첫 픽업 hh:mm"을 한 번 보냅니다. 누르면 홈(오늘이 골라진 주간 달력과 오늘 픽업)이 열립니다.
 * 스토어마다 알림 설정에서 끌 수 있고(기본 켬), 하루에 한 번만 보내려고 보낸 날을 알림 설정 행에 적어 둡니다.
 */
@Injectable()
export class SellerMorningSummaryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly intervalMs = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerFcmPushService: SellerFcmPushService,
  ) {}

  onModuleInit(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 지금이 보내는 시간대면, 오늘 아직 보내지 않은 스토어에 아침 요약을 보냅니다.
   * 실패해도 예외를 던지지 않습니다.
   * @returns 보낸 스토어 수
   */
  async runOnce(now: Date = new Date()): Promise<{ sentStores: number }> {
    try {
      const { dateKey, hour } = kstClock(now);
      if (hour < MORNING_SUMMARY_START_HOUR_KST || hour >= MORNING_SUMMARY_END_HOUR_KST) {
        return { sentStores: 0 };
      }

      // 알림을 받을 휴대폰이 있는 사장님만(앱에서 로그인한 사장님)
      const tokenOwners = await this.prisma.sellerFcmToken.findMany({
        distinct: ["sellerId"],
        select: { sellerId: true },
      });
      if (tokenOwners.length === 0) return { sentStores: 0 };

      const stores = await this.prisma.store.findMany({
        where: { sellerId: { in: tokenOwners.map((owner) => owner.sellerId) } },
        select: { id: true, name: true, sellerId: true },
      });
      const storeCountBySeller = new Map<string, number>();
      for (const store of stores) {
        storeCountBySeller.set(store.sellerId, (storeCountBySeller.get(store.sellerId) ?? 0) + 1);
      }

      const dayStart = koreaCalendarDayStartUtc(dateKey);
      const dayEnd = koreaCalendarDayEndUtc(dateKey);
      let sentStores = 0;

      for (const store of stores) {
        const preference = await this.prisma.userNotificationPreference.upsert({
          where: {
            sellerId_appSurface_storeId: {
              sellerId: store.sellerId,
              appSurface: NotificationAppSurface.SELLER_WEB,
              storeId: store.id,
            },
          },
          create: {
            sellerId: store.sellerId,
            storeId: store.id,
            appSurface: NotificationAppSurface.SELLER_WEB,
            orderNotificationsEnabled: true,
            orderNotificationSoundEnabled: true,
            morningSummaryEnabled: true,
          },
          update: {},
          select: { id: true, morningSummaryEnabled: true, morningSummarySentOn: true },
        });
        if (!preference.morningSummaryEnabled || preference.morningSummarySentOn === dateKey) {
          continue;
        }

        // 보낸 날을 먼저 적어 하루 한 번만(서버가 동시에 돌아도 한 곳만 보냄). 그날 픽업이 없으면 그냥 넘어감
        const claimed = await this.prisma.userNotificationPreference.updateMany({
          where: {
            id: preference.id,
            OR: [{ morningSummarySentOn: null }, { morningSummarySentOn: { not: dateKey } }],
          },
          data: { morningSummarySentOn: dateKey },
        });
        if (claimed.count !== 1) continue;

        const orders = await this.prisma.order.findMany({
          where: {
            storeId: store.id,
            pickupDate: { gte: dayStart, lte: dayEnd },
            orderStatus: { in: MORNING_SUMMARY_ORDER_STATUSES },
          },
          select: { pickupDate: true },
          orderBy: { pickupDate: "asc" },
        });
        const firstPickupAt = orders[0]?.pickupDate;
        if (!firstPickupAt) continue;

        const copy = buildMorningSummaryCopy({
          pickupCount: orders.length,
          firstPickupAt,
          storeName: store.name,
          sellerStoreCount: storeCountBySeller.get(store.sellerId) ?? 1,
        });
        await this.sellerFcmPushService.sendToSeller({
          sellerId: store.sellerId,
          title: copy.title,
          body: copy.body,
          data: {
            type: FCM_PUSH_TYPE.SELLER_MORNING_SUMMARY,
            storeId: store.id,
            path: buildSellerHomePath(store.id),
          },
          androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
        });
        sentStores += 1;
      }

      return { sentStores };
    } catch (e) {
      LoggerUtil.log(
        `[SellerMorningSummaryService] 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
      SentryUtil.captureException(e, "error", {
        module: "seller-morning-summary",
        operation: "run-once",
      });
      return { sentStores: 0 };
    }
  }
}
