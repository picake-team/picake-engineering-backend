import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { UploadService } from "@apps/backend/modules/upload/upload.service";

import { AuthMypageProfileService } from "./auth-mypage-profile.service";

// 프로필 사진을 바꾸거나 지우면 옛 사진 파일을 지운다(11-18, 처리방침 "탈퇴 후 즉시 파기"와 같은 뜻)
describe("AuthMypageProfileService — 옛 프로필 사진 파일 지우기", () => {
  const prisma = mockDeep<PrismaService>();
  const upload = { deleteFilesByUrl: vi.fn() };
  const service = new AuthMypageProfileService(prisma, upload as unknown as UploadService);
  const OLD = "https://cdn.example.com/uploads/old.jpg";
  const NEW = "https://cdn.example.com/uploads/new.jpg";
  const consumer = { sub: "c1", aud: AUDIENCE.CONSUMER, type: "access" } as JwtVerifiedPayload;
  const seller = { sub: "s1", aud: AUDIENCE.SELLER, type: "access" } as JwtVerifiedPayload;

  const row = (profileImageUrl: string | null) =>
    ({
      id: "x",
      phone: "01000000000",
      name: "이름",
      nickname: "닉",
      profileImageUrl,
      termsAgreements: [],
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    upload.deleteFilesByUrl.mockResolvedValue(1);
  });

  it("손님이 사진을 바꾸면 저장한 뒤에 옛 사진을 지운다", async () => {
    const order: string[] = [];
    prisma.consumer.findUnique.mockResolvedValue(row(OLD));
    prisma.consumer.update.mockImplementation((() => {
      order.push("update");
      return Promise.resolve(row(NEW));
    }) as any);
    upload.deleteFilesByUrl.mockImplementation(async () => {
      order.push("delete");
      return 1;
    });

    await service.updateConsumerMypageProfile({ profileImageUrl: NEW }, consumer);

    expect(upload.deleteFilesByUrl).toHaveBeenCalledWith([OLD]);
    expect(order).toEqual(["update", "delete"]);
  });

  it("사장님이 사진을 지우면(null) 옛 사진을 지운다", async () => {
    prisma.seller.findUnique.mockResolvedValue(row(OLD));
    prisma.seller.update.mockResolvedValue(row(null));

    await service.updateSellerMypageProfile({ profileImageUrl: null }, seller);

    expect(upload.deleteFilesByUrl).toHaveBeenCalledWith([OLD]);
  });

  it("사진을 그대로 두거나 이름만 바꾸면 지우지 않는다", async () => {
    prisma.consumer.findUnique.mockResolvedValue(row(OLD));
    prisma.consumer.update.mockResolvedValue(row(OLD));

    await service.updateConsumerMypageProfile({ nickname: "새 닉네임" }, consumer);
    await service.updateConsumerMypageProfile({ profileImageUrl: OLD }, consumer);

    expect(upload.deleteFilesByUrl).not.toHaveBeenCalled();
  });

  it("옛 사진이 없으면 지우지 않는다", async () => {
    prisma.consumer.findUnique.mockResolvedValue(row(null));
    prisma.consumer.update.mockResolvedValue(row(NEW));

    await service.updateConsumerMypageProfile({ profileImageUrl: NEW }, consumer);

    expect(upload.deleteFilesByUrl).not.toHaveBeenCalled();
  });

  it("옛 사진 지우기가 실패해도 프로필 저장은 성공한다", async () => {
    prisma.consumer.findUnique.mockResolvedValue(row(OLD));
    prisma.consumer.update.mockResolvedValue(row(NEW));
    upload.deleteFilesByUrl.mockRejectedValueOnce(new Error("db down"));

    await expect(
      service.updateConsumerMypageProfile({ profileImageUrl: NEW }, consumer),
    ).resolves.toBeDefined();
  });
});
