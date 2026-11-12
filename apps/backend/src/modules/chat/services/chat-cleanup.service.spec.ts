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
