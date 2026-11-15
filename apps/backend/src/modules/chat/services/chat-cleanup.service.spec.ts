import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { UploadService } from "@apps/backend/modules/upload/upload.service";

import { ChatCleanupService } from "./chat-cleanup.service";

/** 채팅 보관 기간 정리: 서버가 하루 안에 다시 켜져도 돌도록 켜질 때 한 번 돈다(2026-11-12) */
describe("ChatCleanupService 켜질 때 정리", () => {
  afterEach(() => vi.useRealTimers());

  it("켜지자마자 한 번 돌고, 하루 뒤에 다시 돈다", async () => {
    vi.useFakeTimers();
    const prisma = mockDeep<PrismaService>();
    prisma.chatThread.findMany.mockResolvedValue([]);
    const service = new ChatCleanupService(prisma, {} as UploadService);

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(prisma.chatThread.findMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(prisma.chatThread.findMany).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });
});

/** 탈퇴: 신고된 대화는 처리 전·처리 뒤 1년 동안 남긴다(P-83, 11-15 검토 전에는 모두 지웠음) */
describe("ChatCleanupService.deleteAllForConsumer", () => {
  it("열린 신고나 1년 안에 처리한 신고가 있는 방은 지우지 않는다", async () => {
    const prisma = mockDeep<PrismaService>();
    prisma.chatThread.findMany.mockResolvedValue([]);
    const service = new ChatCleanupService(prisma, {} as UploadService);
    const now = new Date("2026-11-15T00:00:00Z");

    await service.deleteAllForConsumer("consumer-1", now);

    const where = prisma.chatThread.findMany.mock.calls[0][0]?.where;
    expect(where?.consumerId).toBe("consumer-1");
    expect(where?.reports).toEqual({
      none: { OR: [{ status: "OPEN" }, { resolvedAt: { gte: new Date("2025-11-15T00:00:00Z") } }] },
    });
    expect(prisma.chatMessage.deleteMany).not.toHaveBeenCalled();
  });
});
