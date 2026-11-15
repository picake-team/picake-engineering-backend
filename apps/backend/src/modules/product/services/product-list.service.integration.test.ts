import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";

import { ProductListService } from "@apps/backend/modules/product/services/product-list.service";
import { GetProductsRequestDto } from "@apps/backend/modules/product/dto/product-list.dto";
import {
  ProductCategoryType as C,
  SortBy,
} from "@apps/backend/modules/product/constants/product.constants";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 손님 상품 목록의 카테고리 거르기(11-15 묶음): 묶음 안은 또는, 묶음끼리는 그리고.
 * 정렬마다 쓰는 길이 달라(최신순 = Prisma 조건, 후기순 = SQL 조건) 둘 다 본다.
 */
describe("상품 목록 카테고리 거르기 (integration)", () => {
  async function seed() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const mk = (name: string, productCategoryTypes: C[]) =>
      createTestProduct(prisma, store.id, { name, productCategoryTypes });
    await mk("곰돌이 생일", [C.BIRTHDAY, C.CHARACTER]);
    await mk("꽃 생일", [C.BIRTHDAY, C.FLOWER]);
    await mk("커플 곰", [C.COUPLE, C.CHARACTER]);
    await mk("기본 케이크", []);
    return new ProductListService(prisma);
  }

  const names = (res: { data: { name: string }[] }) => res.data.map((p) => p.name).sort();
  const query = (q: Record<string, unknown>) =>
    plainToInstance(GetProductsRequestDto, { page: 1, limit: 20, sortBy: SortBy.LATEST, ...q });

  it.each([SortBy.LATEST, SortBy.REVIEW_COUNT])(
    "묶음 안은 또는, 묶음끼리는 그리고 (%s)",
    async (sortBy) => {
      const service = await seed();

      // 같은 묶음(상황) 둘 = 둘 중 하나
      expect(
        names(
          await service.getProductsForUser(
            query({ sortBy, productCategoryTypes: [C.BIRTHDAY, C.COUPLE] }),
          ),
        ),
      ).toEqual(["곰돌이 생일", "꽃 생일", "커플 곰"]);

      // 다른 묶음(상황 + 디자인) = 둘 다 맞는 것만
      expect(
        names(
          await service.getProductsForUser(
            query({ sortBy, productCategoryTypes: [C.BIRTHDAY, C.CHARACTER] }),
          ),
        ),
      ).toEqual(["곰돌이 생일"]);

      // 상황 하나 + 디자인 둘 = 생일이면서 캐릭터나 꽃
      expect(
        names(
          await service.getProductsForUser(
            query({ sortBy, productCategoryTypes: [C.BIRTHDAY, C.CHARACTER, C.FLOWER] }),
          ),
        ),
      ).toEqual(["곰돌이 생일", "꽃 생일"]);
    },
  );

  it("옛 값(LOVER)으로 와도 연인·기념일로 거른다", async () => {
    const service = await seed();
    expect(
      names(await service.getProductsForUser(query({ productCategoryTypes: "LOVER" }))),
    ).toEqual(["커플 곰"]);
  });

  it.each([SortBy.LATEST, SortBy.REVIEW_COUNT])(
    "검색어가 같은 뜻 카테고리면 그 카테고리 상품도 찾는다 (%s)",
    async (sortBy) => {
      const service = await seed();
      // 이름에 "남친"이 없어도 연인·기념일 상품이 나온다
      expect(names(await service.getProductsForUser(query({ sortBy, search: "남친" })))).toEqual([
        "커플 곰",
      ]);
      // 이름으로도 그대로 찾는다
      expect(names(await service.getProductsForUser(query({ sortBy, search: "곰" })))).toEqual([
        "곰돌이 생일",
        "커플 곰",
      ]);
    },
  );
});
