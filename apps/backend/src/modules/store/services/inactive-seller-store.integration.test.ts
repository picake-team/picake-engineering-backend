import { describe, expect, it } from "vitest";

import { EnableStatus, SortBy } from "@apps/backend/modules/product/constants/product.constants";
import type { GetProductsRequestDto } from "@apps/backend/modules/product/dto/product-list.dto";
import { ProductDetailService } from "@apps/backend/modules/product/services/product-detail.service";
import { ProductListService } from "@apps/backend/modules/product/services/product-list.service";
import type { LikeProductDetailService } from "@apps/backend/modules/like/services/like-product-detail.service";
import { StoreSortBy } from "@apps/backend/modules/store/constants/store.constants";
import { StoreListService } from "@apps/backend/modules/store/services/store-list.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 정지·탈퇴한 사장님(`isActive: false`) 가게는 손님 목록·검색·지도·지역별 수에서 빠지고,
 * 링크로 연 상품 상세는 판매중지로 보인다(11-15 운영자: 정지한 사장님 가게에 예약이 들어오던 것).
 * 예약 만들기가 막히는 것은 order-create.service.integration.test.ts.
 */
describe("정지·탈퇴한 사장님 가게 (integration)", () => {
  async function setup() {
    const prisma = getTestPrisma();
    const activeSeller = await createTestSeller(prisma);
    const activeStore = await createTestStore(prisma, activeSeller.id, { name: "보통 가게" });
    const activeProduct = await createTestProduct(prisma, activeStore.id, { name: "딸기 케이크" });
    const suspendedSeller = await createTestSeller(prisma, { isActive: false });
    const suspendedStore = await createTestStore(prisma, suspendedSeller.id, {
      name: "정지 가게",
    });
    const suspendedProduct = await createTestProduct(prisma, suspendedStore.id, {
      name: "딸기 생크림 케이크",
    });
    return { prisma, activeStore, activeProduct, suspendedStore, suspendedProduct };
  }

  it("손님 스토어·상품 목록(검색·정렬 SQL·지역별 수)에서 빠진다", async () => {
    const { prisma, activeStore, activeProduct } = await setup();

    const storeList = new StoreListService(prisma, {} as any);
    const listed = await storeList.getStoresForUser({ page: 1, limit: 20 } as any);
    expect(listed.data.map((store) => store.id)).toEqual([activeStore.id]);
    const searched = await storeList.getStoresForUser({
      page: 1,
      limit: 20,
      search: "정지",
    } as any);
    expect(searched.data).toHaveLength(0);
    const ratingSorted = await storeList.getStoresForUser({
      page: 1,
      limit: 20,
      sortBy: StoreSortBy.RATING_AVG,
    } as any);
    expect(ratingSorted.data.map((store) => store.id)).toEqual([activeStore.id]);

    const productList = new ProductListService(prisma);
    const query = (extra: Partial<GetProductsRequestDto>) =>
      productList.getProductsForUser({ page: 1, limit: 20, ...extra } as GetProductsRequestDto);
    const latest = await query({ sortBy: SortBy.LATEST });
    expect(latest.data.map((product) => product.id)).toEqual([activeProduct.id]);
    expect(latest.meta.totalItems).toBe(1);
    const bySearch = await query({ search: "딸기" });
    expect(bySearch.data.map((product) => product.id)).toEqual([activeProduct.id]);
    // 후기 정렬은 SQL로 거른다
    const byRating = await query({ sortBy: SortBy.RATING_AVG });
    expect(byRating.data.map((product) => product.id)).toEqual([activeProduct.id]);

    const regionCounts = await storeList.getRegionCounts();
    const nationwide = regionCounts.find((group) => group.depth1.label === "전국")!;
    expect(nationwide.depth1.storeCount).toBe(1);
  });

  it("링크로 연 상품 상세는 판매중지로 보이고, 보통 가게 상품은 그대로다", async () => {
    const { prisma, activeProduct, suspendedProduct } = await setup();
    const detail = new ProductDetailService(prisma, {} as LikeProductDetailService);

    const suspended = await detail.getProductDetailForUser(suspendedProduct.id);
    expect(suspended.salesStatus).toBe(EnableStatus.DISABLE);
    const active = await detail.getProductDetailForUser(activeProduct.id);
    expect(active.salesStatus).toBe(EnableStatus.ENABLE);
  });
});
