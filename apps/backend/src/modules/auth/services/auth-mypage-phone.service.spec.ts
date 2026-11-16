import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthMypagePhoneService } from "@apps/backend/modules/auth/services/auth-mypage-phone.service";
import type { AuthPhoneService } from "@apps/backend/modules/auth/services/auth-phone.service";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";

/** 번호 바꾸기는 문자 인증부터 — 인증 없이 "이 번호가 회원인지"를 알 수 없게(11-16 검토) */
describe("AuthMypagePhoneService.changePhone 확인 순서", () => {
  function build(verified: boolean) {
    const prisma = mockDeep<PrismaService>();
    const phoneService = {
      checkPhoneVerificationStatus: vi.fn().mockResolvedValue(verified),
    } as unknown as AuthPhoneService;
    prisma.consumer.findUnique.mockImplementation((async (args: { where: { id?: string } }) =>
      args.where.id ? { id: "me", phone: "01011112222" } : { id: "other" }) as never);
    prisma.seller.findUnique.mockImplementation((async (args: { where: { id?: string } }) =>
      args.where.id ? { id: "me", phone: "01011112222" } : { id: "other" }) as never);
    return { prisma, service: new AuthMypagePhoneService(prisma, phoneService) };
  }

  it("인증 안 된 번호는 다른 계정이 쓰는 번호여도 409가 아니라 '인증 필요'(400)", async () => {
    const { service } = build(false);
    for (const aud of [AUDIENCE.CONSUMER, AUDIENCE.SELLER] as const) {
      const user = { sub: "me", aud } as JwtVerifiedPayload;
      await expect(
        service.changePhone({ newPhone: "01033334444" } as never, user, aud),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("인증한 번호가 다른 계정 번호면 409", async () => {
    const { service } = build(true);
    const user = { sub: "me", aud: AUDIENCE.CONSUMER } as JwtVerifiedPayload;
    await expect(
      service.changePhone({ newPhone: "01033334444" } as never, user, AUDIENCE.CONSUMER),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
