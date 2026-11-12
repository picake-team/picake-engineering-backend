import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LikeStoreDetailService } from "@apps/backend/modules/like/services/like-store-detail.service";

import { StoreListService } from "./store-list.service";

/** 지역별 가게 수: 지역마다 세는 질의라 1분 동안 같은 결과를 쓴다(2026-11-12) */
describe("StoreListService.getRegionCounts 캐시", () => {
  const prismaMock = mockDeep<PrismaService>();
  let service: StoreListService;

  beforeEach(() => {
    vi.useFakeTimers();
    prismaMock.store.count.mockReset();
    prismaMock.store.count.mockResolvedValue(1);
    service = new StoreListService(prismaMock, {} as LikeStoreDetailService);
  });
  afterEach(() => vi.useRealTimers());

  it("1분 안에 다시 부르면 DB를 다시 세지 않고, 같은 때 들어온 요청은 계산 하나를 같이 쓴다", async () => {
    const [a, b] = await Promise.all([service.getRegionCounts(), service.getRegionCounts()]);
    const firstCalls = prismaMock.store.count.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    expect(b).toBe(a);

    vi.advanceTimersByTime(59_000);
    await service.getRegionCounts();
    expect(prismaMock.store.count.mock.calls.length).toBe(firstCalls);

    vi.advanceTimersByTime(2_000);
    await service.getRegionCounts();
    expect(prismaMock.store.count.mock.calls.length).toBe(firstCalls * 2);
  });

  it("세다가 실패하면 다음 요청에서 다시 센다", async () => {
    prismaMock.store.count.mockRejectedValueOnce(new Error("db"));
    await expect(service.getRegionCounts()).rejects.toThrow("db");
    prismaMock.store.count.mockResolvedValue(2);
    const counts = await service.getRegionCounts();
    expect(counts.length).toBeGreaterThan(0);
  });
});
