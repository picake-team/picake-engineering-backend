import { describe, expect, it } from "vitest";

import { EnableStatus, Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { LikeStoreDetailService } from "@apps/backend/modules/like/services/like-store-detail.service";
import { StoreListService } from "@apps/backend/modules/store/services/store-list.service";
import type { GetStoresRequestDto } from "@apps/backend/modules/store/dto/store-list.dto";
import type { CakeSizeDisplayName } from "@apps/backend/modules/product/constants/product.constants";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 손님 가게 목록의 케이크 크기 거르기(도시락·미니·1호…).
 * 상품 상태는 DB에서 enum이라 직접 쓴 SQL에서 글자와 그대로 비교하면 오류가 났다(2026-11-12 상용 로그로 찾음).
 */
describe("가게 목록 케이크 크기 거르기 (integration)", () => {
  const sizeOptions = (names: string[]) =>
    names.map((displayName, i) => ({
      id: `size-${i}`,
      displayName,
      lengthCm: 10,
      price: 0,
      description: "",
      visible: EnableStatus.ENABLE,
    })) as unknown as Prisma.InputJsonValue;

  it("도시락 크기가 있는 판매 중 상품의 가게만 나온다", async () => {
    const prisma = getTestPrisma();
    const service = new StoreListService(prisma, new LikeStoreDetailService(prisma));
    // 한 사장님의 가게는 사업자번호가 겹치면 안 되므로 가게마다 사장님을 따로 만든다
    const newStore = async () => createTestStore(prisma, (await createTestSeller(prisma)).id);
    const withDosirak = await newStore();
    const onlyMini = await newStore();
    const hidden = await newStore();
    await createTestProduct(prisma, withDosirak.id, {
      cakeSizeOptions: sizeOptions(["도시락", "1호"]),
    });
    await createTestProduct(prisma, onlyMini.id, { cakeSizeOptions: sizeOptions(["미니"]) });
    await createTestProduct(prisma, hidden.id, {
      cakeSizeOptions: sizeOptions(["도시락"]),
      visibilityStatus: EnableStatus.DISABLE,
    });

    const res = await service.getStoresForUser({
      page: 1,
      limit: 50,
      sizes: ["도시락" as CakeSizeDisplayName],
    } as GetStoresRequestDto);

    const ids = res.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(withDosirak.id);
    expect(ids).not.toContain(onlyMini.id);
    expect(ids).not.toContain(hidden.id);
  });
});
