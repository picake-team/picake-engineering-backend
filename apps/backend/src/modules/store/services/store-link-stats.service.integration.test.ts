import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { OrderEntrySource } from "@apps/backend/infra/database/prisma/generated/client";
import { StoreLinkStatsService } from "@apps/backend/modules/store/services/store-link-stats.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 링크 효과(기획 I-45): 링크로 들어온 기기 수와 그 링크로 들어온 예약 수를 최근 30일로 센다.
 */
describe("링크 효과 (integration)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function setup() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const user = { sub: seller.id } as JwtVerifiedPayload;
    return { prisma, store, user, service: new StoreLinkStatsService(prisma) };
  }

  it("같은 기기가 여러 번 열면 한 명으로 센다", async () => {
    const { prisma, store, user, service } = await setup();
    const a = randomUUID();
    await service.recordVisit(store.id, a);
    await service.recordVisit(store.id, a);
    await service.recordVisit(store.id, randomUUID());

    expect(await prisma.storeLinkVisit.count({ where: { storeId: store.id } })).toBe(2);
    const stats = await service.getStatsForSeller(store.id, user);
    expect(stats).toEqual({ days: 30, visitorCount: 2, reservationCount: 0 });
  });

  it("30일이 지난 방문과 예약은 세지 않고, 링크로 오지 않은 예약도 세지 않는다", async () => {
    const { prisma, store, user, service } = await setup();
    const now = new Date();
    const old = new Date(now.getTime() - 31 * DAY);
    await prisma.storeLinkVisit.create({
      data: {
        storeId: store.id,
        visitorKey: randomUUID(),
        firstVisitedAt: old,
        lastVisitedAt: old,
      },
    });
    await service.recordVisit(store.id, randomUUID());

    const consumer = await createTestConsumer(prisma);
    const product = await createTestProduct(prisma, store.id);
    const refs = { consumerId: consumer.id, productId: product.id, storeId: store.id };
    await createTestOrder(prisma, refs, { entrySource: OrderEntrySource.STORE_LINK });
    await createTestOrder(prisma, refs, {
      entrySource: OrderEntrySource.STORE_LINK,
      createdAt: old,
    });
    await createTestOrder(prisma, refs);

    const stats = await service.getStatsForSeller(store.id, user, now);
    expect(stats).toEqual({ days: 30, visitorCount: 1, reservationCount: 1 });
  });

  it("다른 판매자의 가게 숫자는 볼 수 없다", async () => {
    const { store, service } = await setup();
    const { user: other } = await setup();
    await expect(service.getStatsForSeller(store.id, other)).rejects.toThrow(ForbiddenException);
  });

  it("없는 가게로는 방문을 남기지 않는다", async () => {
    const { service } = await setup();
    await expect(service.recordVisit("no-such-store", randomUUID())).rejects.toThrow(
      NotFoundException,
    );
  });
});
