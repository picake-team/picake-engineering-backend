import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationAppSurface } from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { ConsumerFcmPushService } from "@apps/backend/modules/fcm/services/consumer-fcm-push.service";
import {
  FCM_ANDROID_CHANNEL_ID,
  FCM_PUSH_TYPE,
} from "@apps/backend/modules/fcm/types/fcm-push.types";
import { NotificationService } from "@apps/backend/modules/notification/services/notification.service";
import { toAlimtalkDomainHost } from "@apps/backend/modules/notification/utils/user-order-alimtalk-link.util";
import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import type { QuoteOpsAlertKind } from "@apps/backend/modules/ops-alert/ops-alert-message.util";
import { SolapiService } from "@apps/backend/modules/solapi/solapi.service";
import { isAlimtalkRecipientPhone } from "@apps/backend/modules/solapi/services/consumer-order-alimtalk.service";
import {
  QUOTE_ALIMTALK_TEMPLATE_IDS,
  QUOTE_PUSH_TITLES,
} from "@apps/backend/modules/quote-request/constants/quote.constants";
import {
  formatCake,
  formatKstDateTime,
  formatPickup,
} from "@apps/backend/modules/quote-request/utils/quote-request-label.util";

/** 손님 웹 견적 요청 상세 주소(알림톡 버튼과 같음) */
export function buildConsumerQuotePath(requestId: string): string {
  return `/quote/${encodeURIComponent(requestId)}`;
}

/**
 * 견적 알림(기획 I-46 "견적 보기·고르기"):
 * - 손님: 견적이 올 때마다 앱 휴대폰 알림 + 앱 안 알림. 알림톡은 첫 견적 한 번·마감 3시간 전 한 번 더·견적 없이 마감 때만
 * - 운영자: 디스코드(입점 전 가게를 고름, 입점 전 가게가 답이 없음, 고른 가게가 답이 없음)
 * 알림이 실패해도 견적·고르기는 그대로 둔다 — 이 서비스는 던지지 않는다.
 */
@Injectable()
export class QuoteNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly consumerPush: ConsumerFcmPushService,
    private readonly notificationService: NotificationService,
    private readonly solapi: SolapiService,
    private readonly opsAlert: OpsAlertService,
  ) {}

  /** 견적 도착·고침: 앱 알림 + 앱 안 알림, 첫 견적이면 알림톡 */
  async quoteArrived(input: {
    requestId: string;
    storeName: string;
    total: number;
    edited: boolean;
  }): Promise<void> {
    try {
      const req = await this.loadRequest(input.requestId);
      if (!req) return;
      const title = input.edited ? QUOTE_PUSH_TITLES.EDITED : QUOTE_PUSH_TITLES.ARRIVED;
      const body = `${input.storeName} · ${input.total.toLocaleString("ko-KR")}원`;
      await this.consumerInApp(req.consumerId, input.requestId, title, body);
      if (!input.edited) {
        // 첫 견적 알림톡은 요청마다 한 번(동시에 두 가게가 보내도 한 번만)
        const { count } = await this.prisma.quoteRequest.updateMany({
          where: { id: input.requestId, arrivalAlimtalkAt: null },
          data: { arrivalAlimtalkAt: new Date() },
        });
        if (count === 1) await this.sendArrivedAlimtalk(input.requestId);
      }
    } catch (e) {
      this.logFail("quote-arrived", input.requestId, e);
    }
  }

  /** 마감 3시간 전에 아직 고르지 않았으면 같은 알림톡을 한 번 더 */
  async reminder(requestId: string): Promise<void> {
    try {
      const { count } = await this.prisma.quoteRequest.updateMany({
        where: { id: requestId, reminderAlimtalkAt: null },
        data: { reminderAlimtalkAt: new Date() },
      });
      if (count === 1) await this.sendArrivedAlimtalk(requestId);
    } catch (e) {
      this.logFail("quote-reminder", requestId, e);
    }
  }

  /** 견적 없이 마감: 알림톡 + 앱 알림 + 앱 안 알림(요청마다 한 번) */
  async closedWithoutQuote(requestId: string): Promise<void> {
    try {
      const { count } = await this.prisma.quoteRequest.updateMany({
        where: { id: requestId, closedNoticeAt: null },
        data: { closedNoticeAt: new Date() },
      });
      if (count !== 1) return;
      const req = await this.loadRequest(requestId);
      if (!req) return;
      await this.consumerInApp(
        req.consumerId,
        requestId,
        QUOTE_PUSH_TITLES.CLOSED_NO_QUOTE,
        "아쉽게도 이번에는 견적을 보낸 가게가 없었어요.",
      );
      await this.sendAlimtalk(req, QUOTE_ALIMTALK_TEMPLATE_IDS.CLOSED_NO_QUOTE, {});
    } catch (e) {
      this.logFail("quote-closed", requestId, e);
    }
  }

  ops(kind: QuoteOpsAlertKind, requestId: string, storeName: string): Promise<void> {
    return this.opsAlert.notifyQuote({ kind, requestId, storeName, at: new Date() });
  }

  private loadRequest(requestId: string) {
    return this.prisma.quoteRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        consumerId: true,
        pickupDate: true,
        pickupHourFrom: true,
        pickupHourTo: true,
        pickupStartAt: true,
        deadlineAt: true,
        size: true,
        quantity: true,
        creams: true,
        flavorNote: true,
        consumer: { select: { name: true, nickname: true, phone: true, withdrawnAt: true } },
        _count: { select: { quotes: true } },
      },
    });
  }

  private async consumerInApp(consumerId: string, requestId: string, title: string, body: string) {
    await this.notificationService.createUserWebQuoteNotification({
      recipientUserId: consumerId,
      title,
      body,
      quoteRequestId: requestId,
    });
    const pref = await this.prisma.consumerNotificationPreference.findUnique({
      where: {
        consumerId_appSurface: { consumerId, appSurface: NotificationAppSurface.USER_WEB },
      },
      select: { orderPushEnabled: true },
    });
    // 견적은 주문 알림과 같은 설정을 따른다(손님 알림 설정 "주문 알림")
    if (pref && !pref.orderPushEnabled) return;
    await this.consumerPush.sendToConsumer({
      consumerId,
      title,
      body,
      data: {
        type: FCM_PUSH_TYPE.QUOTE,
        quoteRequestId: requestId,
        path: buildConsumerQuotePath(requestId),
      },
      androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
    });
  }

  private async sendArrivedAlimtalk(requestId: string) {
    const req = await this.loadRequest(requestId);
    if (!req) return;
    await this.sendAlimtalk(req, QUOTE_ALIMTALK_TEMPLATE_IDS.ARRIVED, {
      "#{견적수}": String(req._count.quotes),
      "#{마감일시}": formatKstDateTime(req.deadlineAt),
    });
  }

  private async sendAlimtalk(
    req: NonNullable<Awaited<ReturnType<QuoteNotifyService["loadRequest"]>>>,
    templateId: string,
    extra: Record<string, string>,
  ) {
    const phone = req.consumer.phone;
    if (req.consumer.withdrawnAt || !phone || !isAlimtalkRecipientPhone(phone)) return;
    if (!this.solapi.isAlimtalkEnabled) {
      LoggerUtil.log(`[QuoteNotify] SOLAPI_PFID 미설정 — 알림톡 생략 request=${req.id}`);
      return;
    }
    const domain = toAlimtalkDomainHost(this.configService.get<string>("PUBLIC_USER_DOMAIN") ?? "");
    if (!domain) return;
    try {
      await this.solapi.sendAlimtalk({
        to: phone,
        templateId,
        variables: {
          "#{고객명}": req.consumer.name?.trim() || req.consumer.nickname?.trim() || "고객",
          "#{픽업일}": formatPickup(req),
          "#{케이크}": formatCake(req),
          "#{도메인}": domain,
          "#{요청ID}": req.id,
          ...extra,
        },
        disableSms: true,
      });
    } catch (e) {
      this.logFail("quote-alimtalk", req.id, e);
    }
  }

  private logFail(operation: string, requestId: string, e: unknown) {
    LoggerUtil.log(
      `[QuoteNotify] ${operation} 실패 request=${requestId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    SentryUtil.captureException(e, "warning", { module: "quote", operation, requestId });
  }
}
