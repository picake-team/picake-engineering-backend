import { Injectable } from "@nestjs/common";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { formatBankLabel } from "@apps/backend/common/utils/bank-label.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { NotificationService } from "@apps/backend/modules/notification/services/notification.service";
import { NotificationGateway } from "@apps/backend/modules/notification/gateways/notification.gateway";
import { SellerFcmPushService } from "@apps/backend/modules/fcm/services/seller-fcm-push.service";
import { withSellerStorePrefix } from "@apps/backend/modules/notification/utils/seller-order-notification-copy.util";
import {
  FCM_ANDROID_CHANNEL_ID,
  FCM_PUSH_TYPE,
  buildSellerStoreEditPath,
} from "@apps/backend/modules/fcm/types/fcm-push.types";

/** 계좌번호 끝 4자리만(잠금 화면 알림에도 보이므로) */
export function maskAccountTail(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  return `····${digits.slice(-4)}`;
}

/** 한국 시각 M/D HH:mm */
function kstStamp(at: Date): string {
  const p = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
}

export function buildBankAccountChangedCopy(params: {
  bankName: string | null;
  bankAccountNumber: string;
  changedAt: Date;
}): { title: string; body: string } {
  return {
    title: "정산 계좌가 바뀌었어요",
    body: `${formatBankLabel(params.bankName)} ${maskAccountTail(params.bankAccountNumber)} · ${kstStamp(params.changedAt)}. 직접 바꾸지 않았다면 바로 계좌를 확인해 주세요.`,
  };
}

/**
 * 판매자 스토어 안내(운영자 2026-11-18): 정산 계좌가 바뀌면 그 사장님에게만 알린다(운영자에게는 보내지 않음).
 * 로그인을 누가 훔쳐 계좌를 바꾸면 입금대기 손님이 그 계좌로 입금하게 되는데, 가장 빨리 알아챌 사람은 본인이다.
 * 판매자 화면 알림(목록·화면 안 안내) + 판매자 앱 푸시. 주문 알림 설정과 관계없이 보낸다. 실패해도 저장은 그대로.
 */
@Injectable()
export class SellerStoreNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly gateway: NotificationGateway,
    private readonly sellerPush: SellerFcmPushService,
  ) {}

  async bankAccountChanged(params: {
    sellerId: string;
    storeId: string;
    storeName: string;
    bankName: string | null;
    bankAccountNumber: string;
    changedAt?: Date;
  }): Promise<void> {
    try {
      const copy = buildBankAccountChangedCopy({
        bankName: params.bankName,
        bankAccountNumber: params.bankAccountNumber,
        changedAt: params.changedAt ?? new Date(),
      });
      const item = await this.notificationService.createSellerWebStoreNotification({
        recipientUserId: params.sellerId,
        storeId: params.storeId,
        title: copy.title,
        body: copy.body,
      });
      this.gateway.emitSellerNotification(params.sellerId, item);
      const storeCount = await this.prisma.store.count({ where: { sellerId: params.sellerId } });
      await this.sellerPush.sendToSeller({
        sellerId: params.sellerId,
        title: withSellerStorePrefix(copy.title, params.storeName, storeCount),
        body: copy.body,
        data: {
          type: FCM_PUSH_TYPE.SELLER_STORE_NOTICE,
          storeId: params.storeId,
          path: buildSellerStoreEditPath(params.storeId),
        },
        androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
      });
    } catch (e) {
      LoggerUtil.log(
        `[SellerStoreNotice] 정산 계좌 바뀜 알림 실패 store=${params.storeId}: ${e instanceof Error ? e.message : e}`,
      );
      SentryUtil.captureException(e, "warning", {
        module: "notification",
        operation: "bank-account-changed",
      });
    }
  }
}
