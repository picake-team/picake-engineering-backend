import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { UploadService } from "@apps/backend/modules/upload/upload.service";

/**
 * 손님이 탈퇴하면 채팅 글·사진을 지운다(기획 I-11, 운영자 결정 11-11: 탈퇴 즉시).
 * 방은 남겨 가게 쪽에 "탈퇴한 손님"으로 보이고 더는 쓸 수 없다(가게가 대화 흐름을 잃지 않게).
 * 사진 파일 지우기에 실패해도 탈퇴는 계속한다.
 */
@Injectable()
export class ChatCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

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
