import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  QuoteRequestCloseReason,
  QuoteRequestStatus,
} from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import {
  QUOTE_LIMITS,
  QUOTE_RESERVATION_ACTIVE_STATUSES,
} from "@apps/backend/modules/quote-request/constants/quote.constants";
import { QuoteNotifyService } from "@apps/backend/modules/quote-request/services/quote-notify.service";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";
import { CHAT_QUOTE_PREVIEWS } from "@apps/backend/modules/chat/constants/chat.constants";
import {
  isReminderDue,
  isStalled,
} from "@apps/backend/modules/quote-request/utils/quote-policy.util";

const MS_HOUR = 60 * 60 * 1000;
export const BATCH = 100;

/**
 * 조건에 맞는 줄을 번호 순서로 100개씩 끝까지 돈다. 건너뛰는 줄(아직 때가 아님)이 100개를 넘어도
 * 뒤의 줄이 영영 안 보이는 일이 없게(전에는 같은 앞 100개만 5분마다 다시 봤다)
 */
export async function eachBatch<T extends { id: string }>(
  load: (afterId: string | undefined) => Promise<T[]>,
  handle: (row: T) => Promise<void>,
): Promise<void> {
  let afterId: string | undefined;
  for (;;) {
    const rows = await load(afterId);
    for (const row of rows) await handle(row);
    if (rows.length < BATCH) return;
    afterId = rows[rows.length - 1].id;
  }
}

/**
 * 견적 요청 시간 일(기획 I-46 ②) — 5분마다, 켜질 때도 한 번(하루에 여러 번 배포해도 놓치지 않게).
 * ① 마감 시각이 지난 요청을 마감으로 바꾸고, 견적이 하나도 없었으면 손님에게 알린다
 * ② 마감 3시간 전까지 고르지 않았으면 견적 도착 알림톡을 한 번 더
 * ③ 입점 전 가게가 손님 글에 1시간 답이 없으면 운영자 디스코드(방마다 하루 한 번)
 * ④ 고른 가게가 손님 글에 24시간 답이 없으면 운영자 디스코드(한 번, 손님은 다시 고를 수 있음)
 * 한 번에 많이 붙잡지 않게 100건씩 끝까지 돈다(eachBatch). 실패해도 던지지 않는다.
 */
@Injectable()
export class QuoteJobsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: QuoteNotifyService,
    private readonly quotes: QuoteService,
  ) {}

  onModuleInit(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), QUOTE_LIMITS.JOB_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    for (const [name, job] of [
      ["expire", () => this.expire(now)],
      ["reminder", () => this.reminders(now)],
      ["unentered-no-reply", () => this.unenteredNoReply(now)],
      ["chosen-no-reply", () => this.chosenNoReply(now)],
    ] as const) {
      try {
        await job();
      } catch (e) {
        LoggerUtil.log(`[QuoteJobs] ${name} 실패: ${e instanceof Error ? e.message : String(e)}`);
        SentryUtil.captureException(e, "warning", { module: "quote", operation: `job-${name}` });
      }
    }
  }

  /** ① 마감 */
  async expire(now: Date): Promise<number> {
    const rows = await this.prisma.quoteRequest.findMany({
      where: { status: QuoteRequestStatus.OPEN, deadlineAt: { lte: now } },
      select: { id: true, deadlineAt: true, _count: { select: { quotes: true } } },
      take: BATCH,
    });
    for (const r of rows) {
      const { count } = await this.prisma.quoteRequest.updateMany({
        where: { id: r.id, status: QuoteRequestStatus.OPEN },
        data: {
          status: QuoteRequestStatus.CLOSED,
          closeReason: QuoteRequestCloseReason.EXPIRED,
          closedAt: r.deadlineAt,
        },
      });
      if (count === 1) {
        if (r._count.quotes === 0) await this.notify.closedWithoutQuote(r.id);
        await this.quotes.retireRequestCards(r.id);
      }
    }
    return rows.length;
  }

  /** ② 마감 3시간 전 알림톡 */
  async reminders(now: Date): Promise<number> {
    let sent = 0;
    await eachBatch(
      (afterId) =>
        this.prisma.quoteRequest.findMany({
          where: {
            ...(afterId ? { id: { gt: afterId } } : {}),
            status: QuoteRequestStatus.OPEN,
            chosenTargetId: null,
            arrivalAlimtalkAt: { not: null },
            reminderAlimtalkAt: null,
            deadlineAt: {
              gt: now,
              lte: new Date(now.getTime() + QUOTE_LIMITS.REMINDER_BEFORE_DEADLINE_HOURS * MS_HOUR),
            },
          },
          select: {
            id: true,
            status: true,
            deadlineAt: true,
            closedAt: true,
            chosenTargetId: true,
            chosenAt: true,
            arrivalAlimtalkAt: true,
            reminderAlimtalkAt: true,
          },
          orderBy: { id: "asc" },
          take: BATCH,
        }),
      async (r) => {
        if (!isReminderDue(r, now)) return;
        await this.notify.reminder(r.id);
        sent += 1;
      },
    );
    return sent;
  }

  /** ③ 입점 전 가게가 1시간 답이 없음 */
  async unenteredNoReply(now: Date): Promise<number> {
    const before = new Date(now.getTime() - QUOTE_LIMITS.UNENTERED_NO_REPLY_MINUTES * 60 * 1000);
    let alerted = 0;
    await eachBatch(
      (afterId) =>
        this.prisma.chatThread.findMany({
          where: {
            ...(afterId ? { id: { gt: afterId } } : {}),
            shop: { unentered: true, storeId: null },
            lastMessageSender: "CONSUMER",
            // 고름 카드는 손님 글이 아니다(고르면 바로 "입점 전 가게를 골랐어요" 알림이 따로 감)
            lastMessagePreview: { not: CHAT_QUOTE_PREVIEWS.CHOSEN },
            lastMessageAt: { lte: before, gte: new Date(now.getTime() - 7 * 24 * MS_HOUR) },
            OR: [
              { opsAlertedAt: null },
              { opsAlertedAt: { lte: new Date(now.getTime() - 24 * MS_HOUR) } },
            ],
          },
          select: {
            id: true,
            consumerId: true,
            shopId: true,
            lastMessageAt: true,
            opsAlertedAt: true,
            shop: { select: { name: true } },
          },
          orderBy: { id: "asc" },
          take: BATCH,
        }),
      async (th) => {
        // 알린 뒤 새 글이 없으면 다시 알리지 않는다
        if (th.opsAlertedAt && th.lastMessageAt && th.opsAlertedAt >= th.lastMessageAt) return;
        const target = await this.prisma.quoteRequestStore.findFirst({
          where: { shopId: th.shopId, quoteRequest: { consumerId: th.consumerId } },
          orderBy: { createdAt: "desc" },
          select: { quoteRequestId: true },
        });
        await this.prisma.chatThread.update({ where: { id: th.id }, data: { opsAlertedAt: now } });
        if (target) {
          await this.notify.ops("UNENTERED_NO_REPLY", target.quoteRequestId, th.shop.name);
          alerted += 1;
        }
      },
    );
    return alerted;
  }

  /** ④ 고른 가게가 24시간 답이 없음 */
  async chosenNoReply(now: Date): Promise<number> {
    let alerted = 0;
    await eachBatch(
      (afterId) =>
        this.prisma.quoteRequest.findMany({
          where: {
            ...(afterId ? { id: { gt: afterId } } : {}),
            status: QuoteRequestStatus.CONNECTED,
            stallAlertedAt: null,
            chosenAt: { lte: new Date(now.getTime() - QUOTE_LIMITS.STALL_HOURS * MS_HOUR) },
            deadlineAt: { gt: now },
          },
          select: { id: true, consumerId: true, chosenTargetId: true },
          orderBy: { id: "asc" },
          take: BATCH,
        }),
      async (r) => {
        if (!r.chosenTargetId) return;
        const target = await this.prisma.quoteRequestStore.findUnique({
          where: { id: r.chosenTargetId },
          select: {
            shopId: true,
            name: true,
            store: { select: { name: true } },
            quote: {
              select: {
                orders: {
                  where: { orderStatus: { in: [...QUOTE_RESERVATION_ACTIVE_STATUSES] } },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        });
        if (!target?.shopId) return;
        // 손님이 이 견적으로 예약했으면 예약 흐름(주문)으로 넘어갔다
        if (target.quote?.orders.length) return;
        const thread = await this.prisma.chatThread.findUnique({
          where: { consumerId_shopId: { consumerId: r.consumerId, shopId: target.shopId } },
          select: { lastMessageSender: true, lastConsumerMessageAt: true },
        });
        if (!isStalled(thread, now)) return;
        await this.prisma.quoteRequest.update({
          where: { id: r.id },
          data: { stallAlertedAt: now },
        });
        await this.notify.ops("CHOSEN_NO_REPLY", r.id, target.store?.name ?? target.name);
        alerted += 1;
      },
    );
    return alerted;
  }
}
