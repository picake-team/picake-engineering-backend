import { Injectable } from "@nestjs/common";
import { FcmService } from "@apps/backend/modules/fcm/fcm.service";
import { SellerFcmTokenService } from "@apps/backend/modules/fcm/services/seller-fcm-token.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import {
  FCM_ANDROID_CHANNEL_ID,
  FCM_PUSH_TYPE,
  buildSellerOrderPath,
  type SendSellerOrderPushParams,
  type SendSellerPushParams,
} from "@apps/backend/modules/fcm/types/fcm-push.types";

/** 판매자 앱 테스트 알림 문구 */
export const SELLER_TEST_PUSH_COPY = {
  title: "알림이 잘 와요",
  body: "새 주문이 들어오면 이렇게 알려 드려요.",
} as const;

/**
 * 판매자 앱(Flutter, 기획 I-48) 대상 FCM 푸시.
 *
 * 푸시 `data.path`는 판매자 웹 경로입니다. 앱은 띄우는 주소 뒤에 path를 붙여 그 화면을 엽니다.
 * 알림 종류가 늘어도 path만 달라지므로 앱을 고칠 필요가 없습니다.
 */
@Injectable()
export class SellerFcmPushService {
  constructor(
    private readonly sellerFcmTokenService: SellerFcmTokenService,
    private readonly fcmService: FcmService,
  ) {}

  /**
   * 판매자의 모든 기기로 보냅니다.
   * @returns FCM이 받아들인 기기 수 (FCM이 꺼져 있거나, 등록된 기기가 없거나, 모두 실패하면 0).
   *   실패해도 예외를 던지지 않습니다.
   */
  async sendToSeller(params: SendSellerPushParams): Promise<{ deviceCount: number }> {
    if (!this.fcmService.isEnabled) {
      SentryUtil.captureMessage("[SellerFcmPushService] FCM 비활성화 상태로 발송 스킵", "warning", {
        module: "seller-fcm-push",
        operation: "send-to-seller",
        status: "skipped_fcm_disabled",
        sellerId: params.sellerId,
      });
      return { deviceCount: 0 };
    }

    try {
      const tokens = await this.sellerFcmTokenService.getTokensBySellerId(params.sellerId);
      if (tokens.length === 0) {
        return { deviceCount: 0 };
      }

      const { invalidTokens, successCount } = await this.fcmService.sendToTokens({
        tokens,
        title: params.title,
        body: params.body,
        data: params.data,
        androidChannelId: params.androidChannelId,
      });

      if (invalidTokens.length > 0) {
        await this.sellerFcmTokenService.removeInvalidTokens(invalidTokens);
      }
      return { deviceCount: successCount };
    } catch (e) {
      LoggerUtil.log(
        `[SellerFcmPushService] 실패 seller=${params.sellerId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      SentryUtil.captureException(e, "error", {
        module: "seller-fcm-push",
        operation: "send-to-seller",
        sellerId: params.sellerId,
      });
      return { deviceCount: 0 };
    }
  }

  /** 주문 알림. 누르면 그 주문 상세 화면이 열립니다. */
  async sendOrderPush(params: SendSellerOrderPushParams): Promise<void> {
    await this.sendToSeller({
      sellerId: params.sellerId,
      title: params.title,
      body: params.body,
      data: {
        type: FCM_PUSH_TYPE.SELLER_ORDER,
        storeId: params.storeId,
        orderId: params.orderId,
        path: buildSellerOrderPath(params.storeId, params.orderId),
      },
      androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
    });
  }

  /** 알림 설정에서 누르는 테스트 알림. 앱 심사관과 사장님이 푸시가 오는지 직접 확인할 수 있습니다. */
  async sendTestPush(sellerId: string): Promise<{ deviceCount: number }> {
    return this.sendToSeller({
      sellerId,
      title: SELLER_TEST_PUSH_COPY.title,
      body: SELLER_TEST_PUSH_COPY.body,
      data: { type: FCM_PUSH_TYPE.SELLER_TEST, path: "/" },
      androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
    });
  }
}
