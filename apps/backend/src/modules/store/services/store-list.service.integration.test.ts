import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";

import { EnableStatus, Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { LikeStoreDetailService } from "@apps/backend/modules/like/services/like-store-detail.service";
import { StoreListService } from "@apps/backend/modules/store/services/store-list.service";
import { GetStoresRequestDto } from "@apps/backend/modules/store/dto/store-list.dto";
import {
  type CakeSizeDisplayName,
  ProductCategoryType as C,
} from "@apps/backend/modules/product/constants/product.constants";
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

/**
 * 스토어 목록 카테고리 거르기(11-15 묶음): 상품 하나가 묶음마다 맞아야 그 가게가 나온다.
 * 가게에 생일 상품과 캐릭터 상품이 따로 있으면 "생일 + 캐릭터"에는 나오지 않는다.
 */
describe("스토어 목록 카테고리 거르기 (integration)", () => {
  it("한 상품이 묶음마다 맞는 가게만, 같은 묶음은 또는", async () => {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const split = await createTestStore(prisma, seller.id, { name: "나눠 파는 가게" });
    await createTestProduct(prisma, split.id, { name: "생일", productCategoryTypes: [C.BIRTHDAY] });
    await createTestProduct(prisma, split.id, {
      name: "캐릭터",
      productCategoryTypes: [C.CHARACTER],
    });
    const both = await createTestStore(prisma, seller.id, {
      name: "생일 캐릭터 가게",
      // 같은 사장님의 두 번째 가게(사업자 번호·허가 번호가 같으면 만들 수 없다)
      businessNo: "000-00-00001",
      permissionManagementNumber: "제0000-0001호",
    });
    await createTestProduct(prisma, both.id, {
      name: "생일 캐릭터",
      productCategoryTypes: [C.BIRTHDAY, C.CHARACTER],
    });

    const service = new StoreListService(prisma, {} as unknown as LikeStoreDetailService);
    const names = async (productCategoryTypes: C[]) =>
      (
        await service.getStoresForUser(
          plainToInstance(GetStoresRequestDto, { page: 1, limit: 20, productCategoryTypes }),
        )
      ).data
        .map((s) => s.name)
        .sort();

    expect(await names([C.BIRTHDAY, C.CHARACTER])).toEqual(["생일 캐릭터 가게"]);
    expect(await names([C.BIRTHDAY])).toEqual(["나눠 파는 가게", "생일 캐릭터 가게"]);
    expect(await names([C.BIRTHDAY, C.COUPLE])).toEqual(["나눠 파는 가게", "생일 캐릭터 가게"]);
  });
});
