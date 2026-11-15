import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";

import { ChatAdminService } from "./chat-admin.service";

/** 신고 처리는 열린 신고에만 한 번(11-15 검토: 다시 보내면 결과·처리자가 "0개 가림"으로 덮였음) */
describe("ChatAdminService.resolveReport", () => {
  it("이미 처리한 신고면 409이고 아무것도 바꾸지 않는다", async () => {
    const prisma = mockDeep<PrismaService>();
    prisma.chatReport.findUnique.mockResolvedValue({
      id: "r1",
      messageId: "m1",
      threadId: "t1",
      status: "RESOLVED",
    } as never);
    const service = new ChatAdminService(prisma);

    await expect(
      service.resolveReport("admin-1", "r1", { action: "HIDE_MESSAGE" } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.chatMessage.updateMany).not.toHaveBeenCalled();
    expect(prisma.chatReport.updateMany).not.toHaveBeenCalled();
  });
});
