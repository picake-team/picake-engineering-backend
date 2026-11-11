import { createHash } from "crypto";

import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { OrderStatus } from "@apps/backend/infra/database/prisma/generated/client";
import {
  AUDIENCE,
  SELLER_REVIEW_ACCOUNT_PHONE_MARKER,
  SELLER_REVIEW_SAMPLE_CONSUMER_PHONE_MARKER,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthSellerReviewLoginService } from "@apps/backend/modules/auth/services/auth-seller-review-login.service";
import { AuthWithdrawService } from "@apps/backend/modules/auth/services/auth-withdraw.service";
import type { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { SortBy } from "@apps/backend/modules/product/constants/product.constants";
import type { GetProductsRequestDto } from "@apps/backend/modules/product/dto/product-list.dto";
import { ProductListService } from "@apps/backend/modules/product/services/product-list.service";
import {
  REVIEW_STORE_BUSINESS_NO,
  StoreSortBy,
} from "@apps/backend/modules/store/constants/store.constants";
import { StoreListService } from "@apps/backend/modules/store/services/store-list.service";
import type { TermsService } from "@apps/backend/modules/terms/terms.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/** 테스트에서만 쓰는 코드(실제 심사용 코드는 레포에 두지 않는다) */
const TEST_CODE = "123456";

/**
 * 판매자 앱 심사용 로그인(I-48, SC-62)을 실제 Postgres로 확인한다.
 * - 처음 로그인하면 심사용 계정·가게·예시 상품 2개·상태별 예시 주문 8건이 생긴다.
 * - 다시 로그인하면 계정·가게·상품은 그대로 두고 예시 주문만 처음 상태로 되돌린다.
 * - 손님 스토어·상품 목록(정렬 SQL 포함)에는 심사용 가게가 보이지 않는다. 가게를 정해 연 목록은 보인다.
 * - 심사용 계정은 예시 주문이 진행 중이어도 탈퇴되고, 다음 로그인 때 새로 만들어진다.
 */
describe("AuthSellerReviewLoginService (integration)", () => {
  /** code가 null이면 서버에 코드 환경값이 없는 상태 */
  function buildService(code: string | null = TEST_CODE) {
    const prisma = getTestPrisma();
    const jwtUtil = {
      generateTokenPair: vi.fn().mockResolvedValue({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      }),
    } as unknown as JwtUtil;
    const configService = {
      get: () => (code ? createHash("sha256").update(code).digest("hex") : undefined),
    } as any;
    const termsService = {
      recordSellerAgreementsInTransaction: vi.fn().mockResolvedValue(undefined),
    } as unknown as TermsService;
    return {
      service: new AuthSellerReviewLoginService(prisma, jwtUtil, configService, termsService),
      jwtUtil,
    };
  }

  async function reviewData() {
    const prisma = getTestPrisma();
    const seller = await prisma.seller.findUnique({
      where: { phone: SELLER_REVIEW_ACCOUNT_PHONE_MARKER },
    });
    const stores = await prisma.store.findMany({ where: { businessNo: REVIEW_STORE_BUSINESS_NO } });
    const products = await prisma.product.findMany({
      where: { storeId: { in: stores.map((store) => store.id) } },
    });
    const orders = await prisma.order.findMany({
      where: { storeId: { in: stores.map((store) => store.id) } },
      include: { orderItems: true, consumer: true },
      orderBy: { orderNumber: "asc" },
    });
    return { seller, stores, products, orders };
  }

  it("처음 로그인하면 심사용 계정·가게·예시 상품·상태별 예시 주문을 만들고 판매자 토큰을 준다", async () => {
    const { service, jwtUtil } = buildService();

    const result = await service.sellerReviewLogin({ code: TEST_CODE });

    expect(result).toEqual({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    const { seller, stores, products, orders } = await reviewData();
    expect(seller).not.toBeNull();
    expect(seller!.isActive).toBe(true);
    expect(seller!.sellerVerificationStatus).toBe("BUSINESS_VERIFIED");
    expect(jwtUtil.generateTokenPair).toHaveBeenCalledWith({
      sub: seller!.id,
      aud: AUDIENCE.SELLER,
    });
    expect(stores).toHaveLength(1);
    expect(stores[0]!.sellerId).toBe(seller!.id);
    expect(products).toHaveLength(2);
    expect(orders).toHaveLength(8);
    expect(new Set(orders.map((order) => order.orderStatus))).toEqual(
      new Set([
        OrderStatus.RESERVATION_REQUESTED,
        OrderStatus.PAYMENT_PENDING,
        OrderStatus.PAYMENT_COMPLETED,
        OrderStatus.CONFIRMED,
        OrderStatus.PICKUP_PENDING,
        OrderStatus.CANCEL_REFUND_PENDING,
        OrderStatus.PICKUP_COMPLETED,
        OrderStatus.CANCEL_COMPLETED,
      ]),
    );
    for (const order of orders) {
      expect(order.orderItems).toHaveLength(1);
      expect(order.consumer.phone).toBe(SELLER_REVIEW_SAMPLE_CONSUMER_PHONE_MARKER);
    }
  });

  it("다시 로그인하면 계정·가게·상품은 그대로이고 예시 주문만 처음 상태로 되돌린다", async () => {
    const prisma = getTestPrisma();
    const { service } = buildService();
    await service.sellerReviewLogin({ code: TEST_CODE });
    const before = await reviewData();

    // 심사관이 주문을 처리하고 가게 이름·상품 사진을 바꾼 상황
    const requested = before.orders.find(
      (order) => order.orderStatus === OrderStatus.RESERVATION_REQUESTED,
    )!;
    await prisma.order.update({
      where: { id: requested.id },
      data: { orderStatus: OrderStatus.PAYMENT_PENDING },
    });
    await prisma.store.update({ where: { id: before.stores[0]!.id }, data: { name: "바꾼 이름" } });
    await prisma.product.update({
      where: { id: before.products[0]!.id },
      data: { images: ["https://example.com/cake.jpg"] },
    });

    await service.sellerReviewLogin({ code: TEST_CODE });
    const after = await reviewData();

    expect(after.seller!.id).toBe(before.seller!.id);
    expect(after.stores.map((store) => store.id)).toEqual(before.stores.map((store) => store.id));
    expect(after.stores[0]!.name).toBe("바꾼 이름");
    expect(after.products.map((product) => product.id).sort()).toEqual(
      before.products.map((product) => product.id).sort(),
    );
    expect(after.orders).toHaveLength(8);
    expect(after.orders.some((order) => order.id === requested.id)).toBe(false);
    expect(
      after.orders.filter((order) => order.orderStatus === OrderStatus.RESERVATION_REQUESTED),
    ).toHaveLength(1);
    // 바뀐 가게 이름·상품 사진이 새 예시 주문에 들어간다
    expect(after.orders.every((order) => order.storeName === "바꾼 이름")).toBe(true);
    const withPhoto = after.orders.filter((order) => order.productId === before.products[0]!.id);
    expect(
      withPhoto.every((order) => order.productImages[0] === "https://example.com/cake.jpg"),
    ).toBe(true);
  });

  it("지운 예시 상품은 다시 만든다", async () => {
    const prisma = getTestPrisma();
    const { service } = buildService();
    await service.sellerReviewLogin({ code: TEST_CODE });
    const before = await reviewData();
    await prisma.product.delete({ where: { id: before.products[0]!.id } });

    await service.sellerReviewLogin({ code: TEST_CODE });

    const after = await reviewData();
    expect(after.products).toHaveLength(2);
    expect(after.orders).toHaveLength(8);
  });

  it("코드가 틀리거나 서버에 코드가 없으면 401이고 아무것도 만들지 않는다", async () => {
    await expect(buildService().service.sellerReviewLogin({ code: "654321" })).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(buildService(null).service.sellerReviewLogin({ code: TEST_CODE })).rejects.toThrow(
      UnauthorizedException,
    );

    const { seller, stores } = await reviewData();
    expect(seller).toBeNull();
    expect(stores).toHaveLength(0);
  });

  it("손님 스토어·상품 목록(검색·정렬 SQL 포함)에는 심사용 가게가 보이지 않고, 가게를 정해 연 목록에는 보인다", async () => {
    const prisma = getTestPrisma();
    const { service } = buildService();
    await service.sellerReviewLogin({ code: TEST_CODE });
    const { stores, products } = await reviewData();
    const reviewStoreId = stores[0]!.id;

    const normalSeller = await createTestSeller(prisma);
    const normalStore = await createTestStore(prisma, normalSeller.id, { name: "보통 가게" });
    const normalProduct = await createTestProduct(prisma, normalStore.id, { name: "딸기 케이크" });

    const storeList = new StoreListService(prisma, {} as any);
    const listedStores = await storeList.getStoresForUser({ page: 1, limit: 20 } as any);
    expect(listedStores.data.map((store) => store.id)).toEqual([normalStore.id]);
    const searchedStores = await storeList.getStoresForUser({
      page: 1,
      limit: 20,
      search: "심사용",
    } as any);
    expect(searchedStores.data).toHaveLength(0);
    const ratingSorted = await storeList.getStoresForUser({
      page: 1,
      limit: 20,
      sortBy: StoreSortBy.RATING_AVG,
    } as any);
    expect(ratingSorted.data.map((store) => store.id)).toEqual([normalStore.id]);

    const productList = new ProductListService(prisma);
    const query = (extra: Partial<GetProductsRequestDto>) =>
      productList.getProductsForUser({ page: 1, limit: 20, ...extra } as GetProductsRequestDto);

    const latest = await query({ sortBy: SortBy.LATEST });
    expect(latest.data.map((product) => product.id)).toEqual([normalProduct.id]);
    expect(latest.meta.totalItems).toBe(1);
    // "딸기"로 찾아도 심사용 가게의 딸기 케이크는 나오지 않는다
    const searched = await query({ search: "딸기" });
    expect(searched.data.map((product) => product.id)).toEqual([normalProduct.id]);
    // 후기 정렬은 SQL로 거른다
    const byRating = await query({ sortBy: SortBy.RATING_AVG });
    expect(byRating.data.map((product) => product.id)).toEqual([normalProduct.id]);
    // 링크로 연 심사용 가게 상세의 상품 목록은 보인다
    const inReviewStore = await query({ storeId: reviewStoreId });
    expect(inReviewStore.data.map((product) => product.id).sort()).toEqual(
      products.map((product) => product.id).sort(),
    );

    // 지역별 스토어 수에도 들어가지 않는다: 심사용 가게(서울 중구, 노출 상품 있음)가 빠져 서울은 0, 전국은 보통 가게 1
    const regionCounts = await storeList.getRegionCounts();
    const seoul = regionCounts.find((group) => group.depth1.label === "서울")!;
    expect(seoul.depth1.storeCount).toBe(0);
    expect(seoul.depth2.find((region) => region.label === "중구")?.storeCount ?? 0).toBe(0);
    const nationwide = regionCounts.find((group) => group.depth1.label === "전국")!;
    expect(nationwide.depth1.storeCount).toBe(1);
  });

  it("심사용 계정은 예시 주문이 진행 중이어도 탈퇴되고, 다음 로그인 때 새 계정·가게로 다시 만든다", async () => {
    const prisma = getTestPrisma();
    const { service } = buildService();
    await service.sellerReviewLogin({ code: TEST_CODE });
    const before = await reviewData();

    const withdrawService = new AuthWithdrawService(
      prisma,
      { revokeToken: vi.fn() } as any,
      {
        deleteAllForConsumer: vi.fn(),
      } as any,
      { deleteAllForConsumer: vi.fn() } as any,
    );
    await withdrawService.withdraw(AUDIENCE.SELLER, before.seller!.id, "심사 확인");

    const withdrawn = await prisma.seller.findUnique({ where: { id: before.seller!.id } });
    expect(withdrawn!.isActive).toBe(false);
    expect(withdrawn!.phone).toBe(`withdrawn_${before.seller!.id}`);
    expect(await prisma.store.count({ where: { businessNo: REVIEW_STORE_BUSINESS_NO } })).toBe(0);

    await service.sellerReviewLogin({ code: TEST_CODE });
    const after = await reviewData();
    expect(after.seller!.id).not.toBe(before.seller!.id);
    expect(after.stores).toHaveLength(1);
    expect(after.orders).toHaveLength(8);
  });
});
