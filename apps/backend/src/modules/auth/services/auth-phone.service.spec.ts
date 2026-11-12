import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthSmsService } from "@apps/backend/modules/auth/services/auth-sms.service";

import { AuthPhoneService } from "./auth-phone.service";

/** 문자 인증 남용 막기(2026-11-12): 다시 받기 30초, 번호당 하루 10번, 5번 틀리면 다시 받기 */
describe("AuthPhoneService 문자 인증 남용 막기", () => {
  const prismaMock = mockDeep<PrismaService>();
  const smsMock = { sendVerificationCode: vi.fn() };
  const configMock = { get: vi.fn(() => "production") } as unknown as ConfigService;
  const phone = "01012345678";
  const dto = { phone, audience: "consumer", purpose: "registration" } as never;
  let service: AuthPhoneService;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.phoneVerification.findMany.mockReset();
    prismaMock.phoneVerification.findFirst.mockReset();
    prismaMock.phoneVerification.update.mockReset();
    prismaMock.$transaction.mockImplementation(((fn: (tx: PrismaService) => Promise<unknown>) =>
      fn(prismaMock)) as never);
    service = new AuthPhoneService(prismaMock, smsMock as unknown as AuthSmsService, configMock);
  });

  const sent = (agoMs: number, purpose = "consumer:registration") => ({
    createdAt: new Date(Date.now() - agoMs),
    purpose,
  });

  it("같은 번호·목적은 30초 안에 다시 받을 수 없고 문자를 보내지 않는다", async () => {
    prismaMock.phoneVerification.findMany.mockResolvedValue([sent(10_000)] as never);
    await expect(service.sendVerificationCode(dto)).rejects.toThrow(
      AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_RESEND_TOO_SOON,
    );
    expect(smsMock.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("한 번호에 24시간 동안 10번 보냈으면 더 보내지 않는다", async () => {
    prismaMock.phoneVerification.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => sent(60_000 * (i + 1))) as never,
    );
    await expect(service.sendVerificationCode(dto)).rejects.toThrow(
      AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_DAILY_LIMIT,
    );
    expect(smsMock.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("30초가 지났고 하루 한도 안이면 이전 번호를 만료시키고 새로 보낸다", async () => {
    prismaMock.phoneVerification.findMany.mockResolvedValue([sent(31_000)] as never);
    await service.sendVerificationCode(dto);
    expect(prismaMock.phoneVerification.updateMany).toHaveBeenCalled();
    expect(prismaMock.phoneVerification.create).toHaveBeenCalled();
    expect(smsMock.sendVerificationCode).toHaveBeenCalledTimes(1);
  });

  it("인증번호를 5번 틀리면 그 번호를 만료시키고, 맞는 번호를 넣어도 다시 받으라고 한다", async () => {
    const record = {
      id: "v1",
      verificationCode: "123456",
      expiresAt: new Date(Date.now() + 60_000),
    };
    prismaMock.phoneVerification.findFirst.mockResolvedValue(record as never);
    const verify = (code: string) =>
      service.verifyPhoneCode({ ...(dto as object), verificationCode: code } as never);

    for (let i = 0; i < 4; i++) {
      await expect(verify("000000")).rejects.toThrow(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_FAILED);
    }
    await expect(verify("000000")).rejects.toThrow(
      AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_TOO_MANY_ATTEMPTS,
    );
    expect(prismaMock.phoneVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v1" } }),
    );
    await expect(verify("123456")).rejects.toThrow(
      AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_TOO_MANY_ATTEMPTS,
    );
  });

  it("맞는 번호면 인증된다", async () => {
    prismaMock.phoneVerification.findFirst.mockResolvedValue({
      id: "v2",
      verificationCode: "654321",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    await expect(
      service.verifyPhoneCode({ ...(dto as object), verificationCode: "654321" } as never),
    ).resolves.toBeUndefined();
    expect(prismaMock.phoneVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isVerified: true } }),
    );
  });

  it("틀린 번호는 400(인증번호가 올바르지 않아요)", async () => {
    prismaMock.phoneVerification.findFirst.mockResolvedValue({
      id: "v3",
      verificationCode: "111111",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    await expect(
      service.verifyPhoneCode({ ...(dto as object), verificationCode: "222222" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
