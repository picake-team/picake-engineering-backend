import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { CHAT_ERROR_MESSAGES } from "@apps/backend/modules/chat/constants/chat.constants";
import {
  AdminChatReportListQueryDto,
  AdminChatReportResolveDto,
} from "@apps/backend/modules/chat/dto/chat.dto";
import { ChatOpenService } from "@apps/backend/modules/chat/services/chat-open.service";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";

const HOUR_MS = 60 * 60 * 1000;

/**
 * 관리자 채팅(기획 I-11): 신고 목록·상세·처리, 채팅 여는 시각.
 * 운영자는 신고된 대화만 열고, 열 때마다 기록을 남긴다(처리방침 제9조 개정안).
 */
@Injectable()
export class ChatAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly open: ChatOpenService,
  ) {}

  /**
   * 매일 브리핑용 숫자(hq `오늘 · 매일 브리핑`, 기획 I-11 "운영자는 브리핑으로만 본다"). 대화 내용은 없다.
   * - 처리할 신고 수와 가장 오래된 신고 시각(24시간 안 처리)
   * - 손님 글에 스토어가 아직 답하지 않은 방: 스토어별 수와 24시간 넘은 수(차단·탈퇴 방, 심사용 가게는 뺌)
   * - 최근 24시간 글 수·새 방 수
   */
  async summary(now: Date = new Date()) {
    const dayAgo = new Date(now.getTime() - 24 * HOUR_MS);
    const [open, openReports, oldestReport, awaiting, messages24h, threads24h] = await Promise.all([
      this.open.isOpen(),
      this.prisma.chatReport.count({ where: { status: "OPEN" } }),
      this.prisma.chatReport.findFirst({
        where: { status: "OPEN" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      this.prisma.chatThread.findMany({
        where: {
          lastMessageSender: "CONSUMER",
          blockedByShopAt: null,
          blockedByConsumerAt: null,
          consumer: { withdrawnAt: null },
          shop: { store: { businessNo: { not: REVIEW_STORE_BUSINESS_NO } } },
        },
        select: { lastMessageAt: true, shop: { select: { storeId: true, name: true } } },
      }),
      this.prisma.chatMessage.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.chatThread.count({ where: { createdAt: { gte: dayAgo } } }),
    ]);
    const byStore = new Map<
      string,
      { storeId: string; storeName: string; awaiting: number; over24h: number }
    >();
    for (const t of awaiting) {
      if (!t.shop.storeId) continue;
      const row = byStore.get(t.shop.storeId) ?? {
        storeId: t.shop.storeId,
        storeName: t.shop.name,
        awaiting: 0,
        over24h: 0,
      };
      row.awaiting += 1;
      if (t.lastMessageAt && t.lastMessageAt < dayAgo) row.over24h += 1;
      byStore.set(t.shop.storeId, row);
    }
    return {
      open,
      openReports,
      oldestOpenReportAt: oldestReport?.createdAt.toISOString() ?? null,
      awaitingReplyByStore: [...byStore.values()].sort(
        (a, b) => b.over24h - a.over24h || b.awaiting - a.awaiting,
      ),
      messagesLast24h: messages24h,
      newThreadsLast24h: threads24h,
    };
  }

  async getOpenConfig() {
    const opensAt = await this.open.getOpensAt();
    return { chatOpensAt: opensAt?.toISOString() ?? null, open: await this.open.isOpen() };
  }

  async setOpenConfig(chatOpensAt: string | null | undefined) {
    let value: Date | null = null;
    if (chatOpensAt) {
      value = new Date(chatOpensAt);
      if (Number.isNaN(value.getTime()))
        throw new BadRequestException("여는 시각 형식이 맞지 않아요.");
    }
    await this.open.setOpensAt(value);
    return this.getOpenConfig();
  }

  async listReports(query: AdminChatReportListQueryDto) {
    const rows = await this.prisma.chatReport.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        reason: true,
        reporter: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        thread: { select: { id: true, shop: { select: { name: true } } } },
      },
    });
    return {
      reports: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        reporter: r.reporter,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        threadId: r.thread.id,
        shopName: r.thread.shop.name,
      })),
    };
  }

  /** 신고 상세 — 신고된 메시지 앞뒤 대화(최근 50개). 열 때마다 열람 기록 */
  async getReport(adminId: string, reportId: string) {
    const report = await this.prisma.chatReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        reason: true,
        reporter: true,
        detail: true,
        status: true,
        resolution: true,
        messageId: true,
        createdAt: true,
        resolvedAt: true,
        threadId: true,
        thread: {
          select: {
            consumer: { select: { id: true, nickname: true } },
            shop: { select: { name: true, storeId: true } },
          },
        },
      },
    });
    if (!report) throw new NotFoundException(CHAT_ERROR_MESSAGES.REPORT_NOT_FOUND);
    await this.prisma.chatAccessLog.create({
      data: { adminId, threadId: report.threadId, reportId: report.id },
    });
    const messages = await this.prisma.chatMessage.findMany({
      where: { threadId: report.threadId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        sender: true,
        kind: true,
        text: true,
        maskedText: true,
        imageUrls: true,
        hiddenAt: true,
        createdAt: true,
      },
    });
    return {
      id: report.id,
      reason: report.reason,
      reporter: report.reporter,
      detail: report.detail,
      status: report.status,
      resolution: report.resolution,
      messageId: report.messageId,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: report.resolvedAt?.toISOString() ?? null,
      threadId: report.threadId,
      consumerId: report.thread.consumer.id,
      consumerNickname: report.thread.consumer.nickname,
      shopName: report.thread.shop.name,
      storeId: report.thread.shop.storeId,
      // 운영자는 원문을 본다(거르기 전 글). 가린 글도 그대로 보여 준다
      messages: messages.reverse().map((m) => ({
        id: m.id,
        sender: m.sender,
        kind: m.kind,
        text: m.text,
        maskedText: m.maskedText,
        imageUrls: m.imageUrls,
        hidden: !!m.hiddenAt,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async resolveReport(adminId: string, reportId: string, dto: AdminChatReportResolveDto) {
    const report = await this.prisma.chatReport.findUnique({
      where: { id: reportId },
      select: { id: true, messageId: true, threadId: true },
    });
    if (!report) throw new NotFoundException(CHAT_ERROR_MESSAGES.REPORT_NOT_FOUND);
    let hidden = 0;
    if (dto.action === "HIDE_MESSAGE") {
      const ids = dto.messageIds?.length
        ? [...new Set(dto.messageIds)]
        : report.messageId
          ? [report.messageId]
          : [];
      if (ids.length === 0) {
        throw new BadRequestException("가릴 메시지를 대화에서 골라 주세요.");
      }
      // 이 방의 메시지만 가린다(다른 방 id를 넣어도 바뀌지 않음)
      const r = await this.prisma.chatMessage.updateMany({
        where: { id: { in: ids }, threadId: report.threadId, hiddenAt: null },
        data: { hiddenAt: new Date() },
      });
      hidden = r.count;
    }
    await this.prisma.chatReport.update({
      where: { id: report.id },
      data: {
        status: "RESOLVED",
        resolution: [
          dto.action === "HIDE_MESSAGE" ? `메시지 ${hidden}개 가림` : "그대로 둠",
          dto.note?.trim(),
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 200),
        resolvedByAdminId: adminId,
        resolvedAt: new Date(),
      },
    });
    return this.getReport(adminId, reportId);
  }
}
