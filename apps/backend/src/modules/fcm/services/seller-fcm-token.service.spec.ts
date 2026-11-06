import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";

import { SellerFcmTokenService } from "./seller-fcm-token.service";

describe("SellerFcmTokenService.syncToken", () => {
  const prismaMock = mockDeep<PrismaService>();
  let service: SellerFcmTokenService;

  beforeEach(async () => {
    vi.clearAllMocks();
    // $transaction(callback)은 같은 mock을 tx로 넘겨 실행
    prismaMock.$transaction.mockImplementation((async (cb: (tx: PrismaService) => unknown) =>
      cb(prismaMock)) as never);

    const moduleRef = await Test.createTestingModule({
      providers: [SellerFcmTokenService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(SellerFcmTokenService);
  });

  it("빈 토큰이면 그 기기 토큰만 지운다 (로그아웃)", async () => {
    await service.syncToken("seller-1", " device-1 ", "  ");

    expect(prismaMock.sellerFcmToken.deleteMany).toHaveBeenCalledWith({
      where: { sellerId: "seller-1", deviceId: "device-1" },
    });
    expect(prismaMock.sellerFcmToken.upsert).not.toHaveBeenCalled();
  });

  it("기기 ID가 비어 있으면 아무것도 하지 않는다", async () => {
    await service.syncToken("seller-1", "  ", "token-a");

    expect(prismaMock.sellerFcmToken.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.sellerFcmToken.upsert).not.toHaveBeenCalled();
  });

  it("같은 토큰이 다른 계정·기기에 있으면 지우고, 이 기기 토큰을 저장한다", async () => {
    await service.syncToken("seller-1", "device-1", " token-a ");

    expect(prismaMock.sellerFcmToken.deleteMany).toHaveBeenCalledWith({
      where: { token: "token-a", NOT: { sellerId: "seller-1", deviceId: "device-1" } },
    });
    expect(prismaMock.sellerFcmToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId_deviceId: { sellerId: "seller-1", deviceId: "device-1" } },
        create: { sellerId: "seller-1", deviceId: "device-1", token: "token-a" },
      }),
    );
  });
});
