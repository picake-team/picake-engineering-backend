import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  NotificationAppSurface,
  Prisma,
} from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { SolapiService } from "@apps/backend/modules/solapi/solapi.service";
import { isAlimtalkRecipientPhone } from "@apps/backend/modules/solapi/services/consumer-order-alimtalk.service";
import { toAlimtalkDomainHost } from "@apps/backend/modules/notification/utils/user-order-alimtalk-link.util";
import {
  CHAT_ALIMTALK_TEMPLATE_IDS,
  CHAT_LIMITS,
} from "@apps/backend/modules/chat/constants/chat.constants";
import { isAlimtalkDue, isSeoulNight } from "@apps/backend/modules/chat/utils/chat-policy.util";

/** 1분마다 확인 */
const INTERVAL_MS = 60 * 1000;
/** 한 번에 볼 방 수(쪽마다) */
export const CHAT_ALIMTALK_BATCH = 100;
/**
 * 이보다 오래된 글은 보지 않는다. 밤에 미뤄도 11시간이면 충분하고,
 * ① 처음 배포할 때 며칠 전 안 읽은 방마다 알림톡이 가지 않게 ② 알림을 끈 사람·탈퇴한 사람처럼
 * 영영 안 보낼 방이 오래된 것부터 고르는 100칸을 채워 새 방이 밀리지 않게.
 */
export const CHAT_ALIMTALK_LOOKBACK_HOURS = 24;

type Side = "CONSUMER" | "SHOP";

/**
 * 채팅 알림톡(기획 I-11·P-82): 상대 글을 앱 알림으로 못 봤거나 안 읽은 사람에게 카카오 알림톡을 보낸다.
 * - 앱 알림 받을 기기가 없으면 10분, 있으면 60분 뒤에도 안 읽었을 때(`isAlimtalkDue`)
 * - 방마다 3시간에 한 번, 그 글 뒤에 이미 보냈으면 다시 안 보냄, 밤 9시~아침 8시는 아침까지 미룸
 * - 알림을 끈 방·채팅 알림을 끈 사람에게는 보내지 않음, 서비스 전체 하루 200건까지
 * - 보내기 전에 마지막 알림 시각을 먼저 적어(조건부 update) 두 번 보내지 않는다(주문 안내와 같은 방식)
 */
@Injectable()
export class ChatAlimtalkService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private sentDay = "";
  private sentCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly solapi: SolapiService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) return;
    this.timer = setInterval(() => void this.runOnce(), INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private enabled(): boolean {
    return (
      this.solapi.isAlimtalkEnabled &&
      !!(CHAT_ALIMTALK_TEMPLATE_IDS.CONSUMER_REPLY || CHAT_ALIMTALK_TEMPLATE_IDS.SELLER_NEW_MESSAGE)
    );
  }

  /** 한 번 돈다. 보낸 수를 돌려준다(테스트용). 기다리지 않고 부르므로 오류는 안에서 잡는다 */
  async runOnce(now: Date = new Date()): Promise<number> {
    try {
      if (!this.enabled() || isSeoulNight(now)) return 0;
      await this.syncDailyCount(now);
      let sent = 0;
      if (CHAT_ALIMTALK_TEMPLATE_IDS.CONSUMER_REPLY) sent += await this.consumerSide(now);
      if (CHAT_ALIMTALK_TEMPLATE_IDS.SELLER_NEW_MESSAGE) sent += await this.shopSide(now);
      return sent;
    } catch (e) {
      LoggerUtil.log(`[ChatAlimtalk] 실패: ${e instanceof Error ? e.message : String(e)}`);
      SentryUtil.captureException(e, "warning", { module: "chat", operation: "chat-alimtalk" });
      return 0;
    }
  }

  // ───────────────────────── 손님: 가게 답 ─────────────────────────

  private async consumerSide(now: Date): Promise<number> {
    const ids = await this.candidateIds("CONSUMER", now);
    if (ids.length === 0) return 0;
    const rows = await this.prisma.chatThread.findMany({
      where: { id: { in: ids }, consumer: { withdrawnAt: null } },
      select: {
        id: true,
        consumerId: true,
        lastMessageAt: true,
        consumerReadAt: true,
        consumerNotifiedAt: true,
        consumerMuted: true,
        consumer: { select: { phone: true, name: true, nickname: true } },
        shop: { select: { name: true, store: { select: { name: true } } } },
      },
    });
    const domain = toAlimtalkDomainHost(this.config.get<string>("PUBLIC_USER_DOMAIN") ?? "");
    if (!domain) return 0;
    let sent = 0;
    for (const t of rows) {
      if (!t.lastMessageAt || !isAlimtalkRecipientPhone(t.consumer.phone)) continue;
      const [pref, devices] = await Promise.all([
        this.prisma.consumerNotificationPreference.findUnique({
          where: {
            consumerId_appSurface: {
              consumerId: t.consumerId,
              appSurface: NotificationAppSurface.USER_WEB,
            },
          },
          select: { chatPushEnabled: true },
        }),
        this.prisma.consumerFcmToken.count({ where: { consumerId: t.consumerId } }),
      ]);
      const due = isAlimtalkDue({
        now,
        enabled: pref?.chatPushEnabled ?? true,
        muted: t.consumerMuted,
        lastIncomingAt: t.lastMessageAt,
        readAt: t.consumerReadAt,
        notifiedAt: t.consumerNotifiedAt,
        hasPushDevice: devices > 0,
      });
      if (!due || !this.underDailyCap()) continue;
      if (!(await this.claim("CONSUMER", t.id, t.lastMessageAt, now))) continue;
      sent += await this.send("CONSUMER", t.id, {
        to: t.consumer.phone,
        templateId: CHAT_ALIMTALK_TEMPLATE_IDS.CONSUMER_REPLY,
        variables: {
          "#{고객명}": t.consumer.name?.trim() || t.consumer.nickname?.trim() || "고객",
          "#{스토어명}": t.shop.store?.name ?? t.shop.name,
          "#{도메인}": domain,
          "#{채팅ID}": t.id,
        },
      });
    }
    return sent;
  }

  // ───────────────────────── 사장님: 손님 문의 ─────────────────────────

  private async shopSide(now: Date): Promise<number> {
    const ids = await this.candidateIds("SHOP", now);
    if (ids.length === 0) return 0;
    const rows = await this.prisma.chatThread.findMany({
      where: {
        id: { in: ids },
        shop: { store: { seller: { withdrawnAt: null, isActive: true } } },
      },
      select: {
        id: true,
        lastMessageAt: true,
        shopReadAt: true,
        shopNotifiedAt: true,
        shopMuted: true,
        shop: {
          select: {
            storeId: true,
            store: { select: { name: true, sellerId: true, seller: { select: { phone: true } } } },
          },
        },
      },
    });
    const domain = toAlimtalkDomainHost(this.config.get<string>("PUBLIC_SELLER_DOMAIN") ?? "");
    if (!domain) return 0;
    let sent = 0;
    for (const t of rows) {
      const store = t.shop.store;
      if (!t.lastMessageAt || !store || !t.shop.storeId) continue;
      if (!isAlimtalkRecipientPhone(store.seller.phone)) continue;
      const [pref, devices] = await Promise.all([
        this.prisma.userNotificationPreference.findUnique({
          where: {
            sellerId_appSurface_storeId: {
              sellerId: store.sellerId,
              appSurface: NotificationAppSurface.SELLER_WEB,
              storeId: t.shop.storeId,
            },
          },
          select: { chatNotificationsEnabled: true },
        }),
        this.prisma.sellerFcmToken.count({ where: { sellerId: store.sellerId } }),
      ]);
      const due = isAlimtalkDue({
        now,
        enabled: pref?.chatNotificationsEnabled ?? true,
        muted: t.shopMuted,
        lastIncomingAt: t.lastMessageAt,
        readAt: t.shopReadAt,
        notifiedAt: t.shopNotifiedAt,
        hasPushDevice: devices > 0,
      });
      if (!due || !this.underDailyCap()) continue;
      if (!(await this.claim("SHOP", t.id, t.lastMessageAt, now))) continue;
      sent += await this.send("SHOP", t.id, {
        to: store.seller.phone,
        templateId: CHAT_ALIMTALK_TEMPLATE_IDS.SELLER_NEW_MESSAGE,
        variables: {
          "#{스토어명}": store.name,
          "#{도메인}": domain,
          "#{스토어ID}": t.shop.storeId,
          "#{채팅ID}": t.id,
        },
      });
    }
    return sent;
  }

  // ───────────────────────── 공통 ─────────────────────────

  /**
   * 마지막 글(24시간 안)이 상대 것이고, 그 뒤에 읽지도 알림을 보내지도 않았고, 3시간 안에 보내지 않은 방(오래된 것부터).
   * 칸끼리 비교라 SQL로 고른다. 상태 값은 SQL 글자로 넣는다(파라미터로 넣으면 enum = text 오류).
   */
  private async candidateIds(side: Side, now: Date): Promise<string[]> {
    const shortestWait = new Date(
      now.getTime() - CHAT_LIMITS.ALIMTALK_AFTER_MINUTES_NO_PUSH * 60 * 1000,
    );
    const gapCutoff = new Date(now.getTime() - CHAT_LIMITS.ALIMTALK_MIN_GAP_HOURS * 3600 * 1000);
    const oldest = new Date(now.getTime() - CHAT_ALIMTALK_LOOKBACK_HOURS * 3600 * 1000);
    const rows =
      side === "CONSUMER"
        ? await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id FROM chat_threads
            WHERE last_message_sender = 'SHOP'
              AND consumer_muted = false
              AND last_message_at <= ${shortestWait}
              AND last_message_at >= ${oldest}
              AND (consumer_read_at IS NULL OR consumer_read_at < last_message_at)
              AND (consumer_notified_at IS NULL OR (consumer_notified_at < last_message_at AND consumer_notified_at <= ${gapCutoff}))
            ORDER BY last_message_at ASC
            LIMIT ${CHAT_ALIMTALK_BATCH}`)
        : await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id FROM chat_threads
            WHERE last_message_sender = 'CONSUMER'
              AND shop_muted = false
              AND last_message_at <= ${shortestWait}
              AND last_message_at >= ${oldest}
              AND (shop_read_at IS NULL OR shop_read_at < last_message_at)
              AND (shop_notified_at IS NULL OR (shop_notified_at < last_message_at AND shop_notified_at <= ${gapCutoff}))
            ORDER BY last_message_at ASC
            LIMIT ${CHAT_ALIMTALK_BATCH}`);
    return rows.map((r) => r.id);
  }

  /** 보내기 전에 마지막 알림 시각을 먼저 적는다. 다른 실행이 먼저 적었으면 false */
  private async claim(
    side: Side,
    threadId: string,
    lastMessageAt: Date,
    now: Date,
  ): Promise<boolean> {
    const { count } =
      side === "CONSUMER"
        ? await this.prisma.chatThread.updateMany({
            where: {
              id: threadId,
              lastMessageAt,
              OR: [{ consumerNotifiedAt: null }, { consumerNotifiedAt: { lt: lastMessageAt } }],
            },
            data: { consumerNotifiedAt: now },
          })
        : await this.prisma.chatThread.updateMany({
            where: {
              id: threadId,
              lastMessageAt,
              OR: [{ shopNotifiedAt: null }, { shopNotifiedAt: { lt: lastMessageAt } }],
            },
            data: { shopNotifiedAt: now },
          });
    if (count === 1) this.sentCount += 1;
    return count === 1;
  }

  private async send(
    side: Side,
    threadId: string,
    params: { to: string; templateId: string; variables: Record<string, string> },
  ): Promise<number> {
    try {
      await this.solapi.sendAlimtalk({ ...params, disableSms: true });
      return 1;
    } catch (e) {
      // 다시 보내지 않는다(같은 글로 거듭 실패하지 않게). 다음 새 글이 오면 다시 대상이 된다
      LoggerUtil.log(
        `[ChatAlimtalk] 보내기 실패 side=${side} thread=${threadId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      SentryUtil.captureException(e, "warning", {
        module: "chat",
        operation: "chat-alimtalk-send",
      });
      return 0;
    }
  }

  private underDailyCap(): boolean {
    return this.sentCount < CHAT_LIMITS.ALIMTALK_DAILY_CAP;
  }

  /** 한국 날짜가 바뀌면 오늘 보낸 수를 DB에서 다시 센다(서버를 다시 켜도 상한이 이어지게, 방 단위라 조금 적게 셈) */
  private async syncDailyCount(now: Date): Promise<void> {
    const ymd = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    if (this.sentDay === ymd) return;
    const dayStart = new Date(`${ymd}T00:00:00.000+09:00`);
    const [c, s] = await Promise.all([
      this.prisma.chatThread.count({ where: { consumerNotifiedAt: { gte: dayStart } } }),
      this.prisma.chatThread.count({ where: { shopNotifiedAt: { gte: dayStart } } }),
    ]);
    this.sentDay = ymd;
    this.sentCount = c + s;
  }
}
