import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminChatController } from "@apps/backend/apis/admin/controllers/chat-report.controller";
import type { ChatAdminService } from "@apps/backend/modules/chat/services/chat-admin.service";
import type { AuthenticatedUser } from "@apps/backend/modules/auth/types/auth.types";

describe("관리자 채팅 신고 — 원문 열기·처리는 사람 관리자만(11-16 검토)", () => {
  function build() {
    const chatAdmin = {
      getReport: vi.fn().mockResolvedValue({ id: "r1" }),
      resolveReport: vi.fn().mockResolvedValue({ id: "r1" }),
      listReports: vi.fn().mockResolvedValue([]),
      summary: vi.fn().mockResolvedValue({}),
    };
    return {
      chatAdmin,
      controller: new AdminChatController(chatAdmin as unknown as ChatAdminService),
    };
  }
  const apiKey = { sub: "key-1", isApiKey: true } as unknown as AuthenticatedUser;
  const human = { sub: "admin-1", isApiKey: false } as unknown as AuthenticatedUser;

  it("API 키로는 신고 상세(원문)를 열 수 없고 열람 기록도 남지 않는다", async () => {
    const { controller, chatAdmin } = build();
    await expect(controller.report("r1", { user: apiKey })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(chatAdmin.getReport).not.toHaveBeenCalled();
  });

  it("API 키로는 신고를 처리할 수 없다", async () => {
    const { controller, chatAdmin } = build();
    await expect(
      controller.resolve("r1", { action: "KEEP" } as never, { user: apiKey }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(chatAdmin.resolveReport).not.toHaveBeenCalled();
  });

  it("사람 관리자는 열고 처리할 수 있고, 요약·목록은 API 키도 된다", async () => {
    const { controller, chatAdmin } = build();
    await controller.report("r1", { user: human });
    expect(chatAdmin.getReport).toHaveBeenCalledWith("admin-1", "r1");
    await controller.reports({} as never);
    await controller.summary();
    expect(chatAdmin.listReports).toHaveBeenCalled();
  });
});
