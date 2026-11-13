import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { NotificationAppSurface } from "@apps/backend/infra/database/prisma/generated/client";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { NotificationGateway } from "@apps/backend/modules/notification/gateways/notification.gateway";
import { ConsumerFcmPushService } from "@apps/backend/modules/fcm/services/consumer-fcm-push.service";
import { SellerFcmPushService } from "@apps/backend/modules/fcm/services/seller-fcm-push.service";
import {
  FCM_ANDROID_CHANNEL_ID,
  FCM_PUSH_TYPE,
} from "@apps/backend/modules/fcm/types/fcm-push.types";
import { SELLER_CHAT_PUSH_TITLE } from "@apps/backend/modules/chat/constants/chat.constants";
import { shouldPushNow } from "@apps/backend/modules/chat/utils/chat-policy.util";

/** 손님 웹 채팅방 주소 */
export function buildConsumerChatPath(threadId: string): string {
  return `/chat/${encodeURIComponent(threadId)}`;
}

/** 판매자 웹 채팅방 주소. web-seller `ROUTES.STORE_DETAIL_CHAT_ROOM`과 같아야 합니다 */
export function buildSellerChatPath(storeId: string, threadId: string): string {
  return `/stores/${encodeURIComponent(storeId)}/chats/${encodeURIComponent(threadId)}`;
}

/**
 * 새 글이 저장된 뒤 알리기(기획 I-11).
 * - 두 쪽 모두에 소켓 "새 글 있음"(내용 없음) → 웹이 바로 다시 가져온다(내 다른 기기도 같이 맞춰짐)
 * - 받는 쪽에 휴대폰 알림(알림 꺼짐·방 알림 끔·20초 안에 봄·사장님 밤 끄기면 보내지 않음)
 * 알림이 실패해도 보낸 글은 그대로 둔다 — 이 서비스는 던지지 않는다.
 */
@Injectable()
export class ChatNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
    private readonly consumerPush: ConsumerFcmPushService,
    private readonly sellerPush: SellerFcmPushService,
  ) {}

  /**
   * 읽음이 바뀌면 상대 화면에 신호만 보낸다(상대 말풍선 "읽음"이 15초 확인을 기다리지 않게).
   * 안내·휴대폰 알림은 없다. 상대가 신호를 받아 다시 가져와도 새로 읽을 글이 없어 되돌아오지 않는다.
   */
  async afterRead(input: { threadId: string; reader: "CONSUMER" | "SHOP" }): Promise<void> {
    try {
      const thread = await this.prisma.chatThread.findUnique({
        where: { id: input.threadId },
        select: {
          id: true,
          consumerId: true,
          consumerMuted: true,
          shopMuted: true,
          shop: { select: { storeId: true, store: { select: { sellerId: true } } } },
        },
      });
      if (!thread) return;
      const storeId = thread.shop.storeId;
      if (input.reader === "CONSUMER") {
        const sellerId = thread.shop.store?.sellerId;
        if (sellerId) {
          this.gateway.emitChatUpdated(sellerId, {
            threadId: thread.id,
            storeId,
            muted: thread.shopMuted,
          });
        }
      } else {
        this.gateway.emitChatUpdated(thread.consumerId, {
          threadId: thread.id,
          storeId,
          muted: thread.consumerMuted,
        });
      }
    } catch (e) {
      LoggerUtil.log(
        `[ChatNotify] 읽음 신호 실패 thread=${input.threadId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * 견적 카드가 들어간 뒤(기획 I-46 ②): 두 쪽에 소켓 신호, seller가 있으면 사장님 휴대폰 알림(채팅 알림 설정·방 알림 끔·밤 끄기를 따름).
   * 손님 쪽 견적 알림(앱 알림·알림톡)은 견적 서비스가 따로 보낸다. 던지지 않는다.
   */
  async afterQuoteEvent(input: {
    threadId: string;
    seller?: { title: string; body: string };
  }): Promise<void> {
    try {
      const thread = await this.prisma.chatThread.findUnique({
        where: { id: input.threadId },
        select: {
          id: true,
          consumerId: true,
          consumerMuted: true,
          shopMuted: true,
          shop: { select: { storeId: true, store: { select: { sellerId: true, name: true } } } },
        },
      });
      if (!thread) return;
      const storeId = thread.shop.storeId;
      const sellerId = thread.shop.store?.sellerId ?? null;
      this.gateway.emitChatUpdated(thread.consumerId, {
        threadId: thread.id,
        storeId,
        muted: thread.consumerMuted,
      });
      if (!sellerId || !storeId) return;
      this.gateway.emitChatUpdated(sellerId, {
        threadId: thread.id,
        storeId,
        muted: thread.shopMuted,
      });
      if (!input.seller) return;
      const pref = await this.prisma.userNotificationPreference.findUnique({
        where: {
          sellerId_appSurface_storeId: {
            sellerId,
            appSurface: NotificationAppSurface.SELLER_WEB,
            storeId,
          },
        },
        select: { chatNotificationsEnabled: true, chatQuietNight: true },
      });
      if (
        !shouldPushNow({
          now: new Date(),
          enabled: pref?.chatNotificationsEnabled ?? true,
          muted: thread.shopMuted,
          seenAt: null,
          quietNight: pref?.chatQuietNight ?? false,
        })
      ) {
        return;
      }
      const storeCount = await this.prisma.store.count({ where: { sellerId } });
      const title =
        storeCount > 1 && thread.shop.store?.name
          ? `[${thread.shop.store.name}] ${input.seller.title}`
          : input.seller.title;
      await this.sellerPush.sendToSeller({
        sellerId,
        title,
        body: input.seller.body,
        data: {
          type: FCM_PUSH_TYPE.SELLER_CHAT,
          storeId,
          threadId: thread.id,
          path: buildSellerChatPath(storeId, thread.id),
        },
        androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
      });
    } catch (e) {
      LoggerUtil.log(
        `[ChatNotify] 견적 알림 실패 thread=${input.threadId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async afterMessage(input: {
    threadId: string;
    from: "CONSUMER" | "SHOP";
    preview: string;
  }): Promise<void> {
    try {
      const thread = await this.prisma.chatThread.findUnique({
        where: { id: input.threadId },
        select: {
          id: true,
          consumerId: true,
          consumerMuted: true,
          shopMuted: true,
          consumerSeenAt: true,
          shopSeenAt: true,
          consumer: { select: { nickname: true } },
          shop: {
            select: {
              name: true,
              storeId: true,
              store: { select: { sellerId: true, name: true } },
            },
          },
        },
      });
      if (!thread) return;
      const storeId = thread.shop.storeId;
      const sellerId = thread.shop.store?.sellerId ?? null;
      const nickname = thread.consumer.nickname?.trim() || "손님";

      // 소켓 신호(두 쪽 모두)
      this.gateway.emitChatUpdated(thread.consumerId, {
        threadId: thread.id,
        storeId,
        muted: thread.consumerMuted,
      });
      if (sellerId) {
        this.gateway.emitChatUpdated(sellerId, {
          threadId: thread.id,
          storeId,
          senderName: input.from === "CONSUMER" ? nickname : undefined,
          muted: thread.shopMuted,
        });
      }

      const now = new Date();
      if (input.from === "SHOP") {
        const pref = await this.prisma.consumerNotificationPreference.findUnique({
          where: {
            consumerId_appSurface: {
              consumerId: thread.consumerId,
              appSurface: NotificationAppSurface.USER_WEB,
            },
          },
          select: { chatPushEnabled: true },
        });
        if (
          shouldPushNow({
            now,
            enabled: pref?.chatPushEnabled ?? true,
            muted: thread.consumerMuted,
            seenAt: thread.consumerSeenAt,
          })
        ) {
          await this.consumerPush.sendToConsumer({
            consumerId: thread.consumerId,
            title: thread.shop.store?.name ?? thread.shop.name,
            body: input.preview,
            data: {
              type: FCM_PUSH_TYPE.CHAT_MESSAGE,
              threadId: thread.id,
              path: buildConsumerChatPath(thread.id),
            },
            androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
          });
        }
        return;
      }

      if (!sellerId || !storeId) return;
      const pref = await this.prisma.userNotificationPreference.findUnique({
        where: {
          sellerId_appSurface_storeId: {
            sellerId,
            appSurface: NotificationAppSurface.SELLER_WEB,
            storeId,
          },
        },
        select: { chatNotificationsEnabled: true, chatQuietNight: true },
      });
      if (
        !shouldPushNow({
          now,
          enabled: pref?.chatNotificationsEnabled ?? true,
          muted: thread.shopMuted,
          seenAt: thread.shopSeenAt,
          quietNight: pref?.chatQuietNight ?? false,
        })
      ) {
        return;
      }
      const storeCount = await this.prisma.store.count({ where: { sellerId } });
      const title =
        storeCount > 1 && thread.shop.store?.name
          ? `[${thread.shop.store.name}] ${SELLER_CHAT_PUSH_TITLE}`
          : SELLER_CHAT_PUSH_TITLE;
      await this.sellerPush.sendToSeller({
        sellerId,
        title,
        body: `${nickname}: ${input.preview}`,
        data: {
          type: FCM_PUSH_TYPE.SELLER_CHAT,
          storeId,
          threadId: thread.id,
          path: buildSellerChatPath(storeId, thread.id),
        },
        androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
      });
    } catch (e) {
      // 글 내용은 남기지 않는다(Sentry·로그)
      LoggerUtil.log(
        `[ChatNotify] 실패 thread=${input.threadId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
