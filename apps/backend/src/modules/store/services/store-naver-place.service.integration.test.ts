import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import type { NaverPlacePreviewResponseDto } from "@apps/backend/modules/naver-place/dto/naver-place-preview.dto";
import type { NaverPlaceService } from "@apps/backend/modules/naver-place/naver-place.service";
import { StoreNaverPlaceService } from "@apps/backend/modules/store/services/store-naver-place.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import { createTestSeller, createTestStore } from "@apps/backend/test/integration/factories";

/**
 * 네이버 플레이스 연결은 네이버를 실제로 부르지 않고(미리보기는 mock),
 * 연결 정보가 DB에 맞게 저장·삭제되는지와 스토어 정보를 건드리지 않는지를 확인합니다.
 */
describe("스토어 네이버 플레이스 연결 (integration)", () => {
  const preview = (placeId: string): NaverPlacePreviewResponseDto => ({
    placeId,
    placeUrl: `https://map.naver.com/p/entry/place/${placeId}`,
    category: "카페,디저트",
    fetchedAt: new Date().toISOString(),
    storePrefill: {
      name: "네이버에 적힌 다른 이름",
      description: null,
      phoneNumber: null,
      instagramId: null,
      address: null,
      roadAddress: null,
      latitude: null,
      longitude: null,
    },
    businessHours: { days: [], freeText: null },
    warnings: [],
  });

  function buildService(previewImpl = async (id: string) => preview(id)) {
    const prisma = getTestPrisma();
    const naverPlaceService = { preview: vi.fn(previewImpl) } as unknown as NaverPlaceService;
    return { prisma, service: new StoreNaverPlaceService(prisma, naverPlaceService) };
  }

  async function setupStore() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const user = { sub: seller.id } as JwtVerifiedPayload;
    return { store, user };
  }

  it("연결하면 플레이스 ID와 연결 시각이 저장되고, 스토어 정보는 바뀌지 않는다", async () => {
    const { store, user } = await setupStore();
    const { prisma, service } = buildService();

    const result = await service.connectForSeller(store.id, "1234567890", user);

    expect(result.placeId).toBe("1234567890");
    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.naverPlaceId).toBe("1234567890");
    expect(saved.naverPlaceConnectedAt).toBeInstanceOf(Date);
    expect(saved.name).toBe(store.name);
  });

  it("다시 연결하면 새 플레이스로 바뀐다", async () => {
    const { store, user } = await setupStore();
    const { prisma, service } = buildService();

    await service.connectForSeller(store.id, "1234567890", user);
    await service.connectForSeller(store.id, "9876543210", user);

    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.naverPlaceId).toBe("9876543210");
  });

  it("다른 판매자의 스토어에는 연결할 수 없다", async () => {
    const { store } = await setupStore();
    const { user: otherUser } = await setupStore();
    const { prisma, service } = buildService();

    await expect(service.connectForSeller(store.id, "1234567890", otherUser)).rejects.toThrow(
      ForbiddenException,
    );
    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.naverPlaceId).toBeNull();
  });

  it("네이버에서 매장을 확인하지 못하면 저장하지 않는다", async () => {
    const { store, user } = await setupStore();
    const { prisma, service } = buildService(async () => {
      throw new NotFoundException("네이버 플레이스에서 매장을 찾지 못했어요.");
    });

    await expect(service.connectForSeller(store.id, "1234567890", user)).rejects.toThrow(
      NotFoundException,
    );
    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.naverPlaceId).toBeNull();
  });

  it("연결을 끊으면 연결 정보만 비우고 스토어 정보는 그대로 둔다", async () => {
    const { store, user } = await setupStore();
    const { prisma, service } = buildService();
    await service.connectForSeller(store.id, "1234567890", user);

    await service.disconnectForSeller(store.id, user);

    const saved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.naverPlaceId).toBeNull();
    expect(saved.naverPlaceConnectedAt).toBeNull();
    expect(saved.name).toBe(store.name);
  });
});
