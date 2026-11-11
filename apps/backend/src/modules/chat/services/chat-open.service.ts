import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { CHAT_ERROR_MESSAGES } from "@apps/backend/modules/chat/constants/chat.constants";

const CACHE_MS = 30_000;

/**
 * 채팅이 열렸나(기획 I-11). 관리자 전역 설정의 "채팅 여는 시각"(admin_configs.chat_opens_at)을 본다.
 * 비어 있거나 아직이면 닫힘 — 처리방침·약관 시행 시각을 넣어 두면 그때 배포 없이 열린다.
 * 매 요청 DB를 읽지 않게 30초 동안 기억한다(설정을 바꾸면 길어야 30초 뒤 반영).
 */
@Injectable()
export class ChatOpenService {
  private cache: { opensAt: Date | null; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async isOpen(now: Date = new Date()): Promise<boolean> {
    const opensAt = await this.getOpensAt();
    return !!opensAt && opensAt.getTime() <= now.getTime();
  }

  async assertOpen(): Promise<void> {
    if (!(await this.isOpen())) {
      throw new ForbiddenException(CHAT_ERROR_MESSAGES.NOT_OPEN);
    }
  }

  async getOpensAt(): Promise<Date | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.opensAt;
    const row = await this.prisma.adminConfig.findUnique({
      where: { id: "default" },
      select: { chatOpensAt: true },
    });
    const opensAt = row?.chatOpensAt ?? null;
    this.cache = { opensAt, at: Date.now() };
    return opensAt;
  }

  async setOpensAt(opensAt: Date | null): Promise<Date | null> {
    const row = await this.prisma.adminConfig.upsert({
      where: { id: "default" },
      create: { id: "default", chatOpensAt: opensAt },
      update: { chatOpensAt: opensAt },
      select: { chatOpensAt: true },
    });
    this.cache = null;
    return row.chatOpensAt;
  }

  /** 테스트에서 기억을 비운다 */
  resetCache(): void {
    this.cache = null;
  }
}
