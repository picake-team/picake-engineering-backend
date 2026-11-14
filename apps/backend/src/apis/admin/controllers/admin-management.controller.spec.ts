import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";

import { AdminManagementController } from "./admin-management.controller";

/** 가입 설정·가입 승인은 사람 관리자만 바꾼다(API 키가 새도 스스로 관리자를 만들지 못하게) */
describe("AdminManagementController: 바꾸기는 사람 관리자만", () => {
  const service = {
    updateConfig: vi.fn().mockResolvedValue({ requireApproval: true }),
    updateApproval: vi.fn().mockResolvedValue({ id: "a1" }),
    getConfig: vi.fn().mockResolvedValue({ requireApproval: true }),
  };
  const controller = new AdminManagementController(service as never);
  const apiKey = { user: { isApiKey: true } } as never;
  const human = { user: { isApiKey: false } } as never;

  it("API 키로 가입 설정을 바꾸면 막는다", async () => {
    await expect(
      controller.updateConfig(apiKey, { requireApproval: false } as never),
    ).rejects.toThrow(
      new ForbiddenException(AUTH_ERROR_MESSAGES.ADMIN_ACCOUNT_MANAGEMENT_HUMAN_ONLY),
    );
    expect(service.updateConfig).not.toHaveBeenCalled();
  });

  it("API 키로 가입 신청을 승인하면 막는다", async () => {
    await expect(
      controller.updateApproval(apiKey, "a1", { approvalStatus: "APPROVED" } as never),
    ).rejects.toThrow(ForbiddenException);
    expect(service.updateApproval).not.toHaveBeenCalled();
  });

  it("사람 관리자는 바꿀 수 있고, 조회는 API 키도 된다", async () => {
    await expect(
      controller.updateConfig(human, { requireApproval: true } as never),
    ).resolves.toEqual({ requireApproval: true });
    await expect(controller.getConfig()).resolves.toEqual({ requireApproval: true });
  });
});
