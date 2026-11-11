import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { UploadService } from "@apps/backend/modules/upload/upload.service";

/** 보관 기간(운영자 결정 2026-11-11): 마지막 글 3년, 신고된 대화는 처리 뒤 1년 */
export const CHAT_RETENTION = {
  YEARS_AFTER_LAST_MESSAGE: 3,
  YEARS_AFTER_REPORT_RESOLVED: 1,
  /** 한 번에 지우는 방 수(오래 붙잡지 않게) */
  BATCH: 200,
  /** 하루 한 번 */
  INTERVAL_MS: 24 * 60 * 60 * 1000,
} as const;

function yearsBefore(now: Date, years: number): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

/**
 * 채팅 지우기(기획 I-11, 운영자 결정 11-11).
 * - 손님이 탈퇴하면 그 손님의 채팅 글·사진을 바로 지운다. 방은 남겨 가게 쪽에 "탈퇴한 손님"으로 보이고 더는 쓸 수 없다
 * - 하루 한 번: 마지막 글이 3년 지난 방을 지운다. 신고가 처리 중이거나 처리한 지 1년이 안 된 방은 남긴다
 * 사진 파일 지우기에 실패해도 계속한다(탈퇴·정리를 막지 않음).
 */
@Injectable()
export class ChatCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.purgeExpired(), CHAT_RETENTION.INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 보관 기간이 지난 방(글·신고 함께)과 사진을 지운다. 열람 기록(chat_access_logs)은 내용이 없어 남긴다.
   * 실패해도 던지지 않는다.
   * @returns 지운 방 수
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    try {
      const lastCutoff = yearsBefore(now, CHAT_RETENTION.YEARS_AFTER_LAST_MESSAGE);
      const reportCutoff = yearsBefore(now, CHAT_RETENTION.YEARS_AFTER_REPORT_RESOLVED);
      const threads = await this.prisma.chatThread.findMany({
        where: {
          OR: [
            { lastMessageAt: { lt: lastCutoff } },
            { lastMessageAt: null, createdAt: { lt: lastCutoff } },
          ],
          reports: {
            none: { OR: [{ status: "OPEN" }, { resolvedAt: { gte: reportCutoff } }] },
          },
        },
        select: { id: true },
        take: CHAT_RETENTION.BATCH,
      });
      if (threads.length === 0) return 0;
      const ids = threads.map((t) => t.id);
      const rows = await this.prisma.chatMessage.findMany({
        where: { threadId: { in: ids } },
        select: { imageUrls: true },
      });
      const { count } = await this.prisma.chatThread.deleteMany({ where: { id: { in: ids } } });
      const urls = rows.flatMap((r) => r.imageUrls);
      let photos = 0;
      try {
        photos = urls.length ? await this.uploadService.deleteFilesByUrl(urls) : 0;
      } catch (e) {
        SentryUtil.captureException(e, "warning", { module: "chat", operation: "retention-purge" });
      }
      LoggerUtil.log(
        `[ChatCleanup] 보관 기간 지난 채팅방 ${count}개·사진 ${photos}/${urls.length}장 삭제`,
      );
      return count;
    } catch (e) {
      LoggerUtil.log(
        `[ChatCleanup] 보관 기간 정리 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

  async deleteAllForConsumer(consumerId: string): Promise<{ messages: number; photos: number }> {
    const threads = await this.prisma.chatThread.findMany({
      where: { consumerId },
      select: { id: true },
    });
    if (threads.length === 0) return { messages: 0, photos: 0 };
    const threadIds = threads.map((t) => t.id);
    const rows = await this.prisma.chatMessage.findMany({
      where: { threadId: { in: threadIds } },
      select: { imageUrls: true },
    });
    const { count } = await this.prisma.chatMessage.deleteMany({
      where: { threadId: { in: threadIds } },
    });
    await this.prisma.chatThread.updateMany({
      where: { id: { in: threadIds } },
      data: { lastMessagePreview: "손님이 탈퇴해 대화가 지워졌어요" },
    });
    const urls = rows.flatMap((r) => r.imageUrls);
    let photos = 0;
    try {
      photos = urls.length ? await this.uploadService.deleteFilesByUrl(urls) : 0;
    } catch (e) {
      SentryUtil.captureException(e, "warning", { module: "chat", operation: "withdraw-cleanup" });
    }
    LoggerUtil.log(`[ChatCleanup] 탈퇴로 채팅 글 ${count}개·사진 ${photos}/${urls.length}장 삭제`);
    return { messages: count, photos };
  }
}
