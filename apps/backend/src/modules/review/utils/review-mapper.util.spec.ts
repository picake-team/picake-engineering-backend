import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { OrderMapperUtil } from "@apps/backend/modules/order/utils/order-mapper.util";
import { ReviewSortBy } from "@apps/backend/modules/review/constants/review.constants";
import { ReviewListService } from "@apps/backend/modules/review/services/review-list.service";
import { ReviewMapperUtil } from "@apps/backend/modules/review/utils/review-mapper.util";

/** 주문에 붙은 개인정보(공개 후기에 나가면 안 되는 값) */
const order = {
  id: "order-1",
  reservationContactName: "김예약",
  reservationPhone: "01012345678",
  depositorName: "김입금",
  refundBankAccountNumber: "1002123456789",
  productName: "주문 때 상품명",
  totalPrice: 30000,
  productImages: ["https://cdn.example.com/order.jpg"],
};

const review = {
  id: "review-1",
  productId: "product-1",
  consumerId: "consumer-1",
  orderId: "order-1",
  rating: 5,
  content: "맛있어요",
  imageUrls: [],
  createdAt: new Date("2026-11-16T03:00:00Z"),
  updatedAt: new Date("2026-11-16T03:00:00Z"),
  consumer: { nickname: "닉네임", profileImageUrl: null },
  product: {
    storeId: "store-1",
    store: { name: "가게" },
    name: "지금 상품명",
    salePrice: 32000,
    images: [],
  },
  order,
};

describe("후기 응답 — 공개 후기에는 주문(예약자 개인정보)을 싣지 않는다(11-16 검토)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("공개 후기 변환은 주문이 읽혀 있어도 order를 null로 돌려준다", () => {
    const res = ReviewMapperUtil.mapToReviewResponse(review as never);

    expect(res.order).toBeNull();
    expect(res.orderId).toBe("order-1");
    const json = JSON.stringify(res);
    for (const secret of ["01012345678", "김예약", "김입금", "1002123456789"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("내 후기 변환은 본인 주문을 그대로 붙인다(마이페이지 후기 화면이 주문 옵션을 씀)", () => {
    const mapped = { id: "order-1", mapped: true };
    const spy = vi.spyOn(OrderMapperUtil, "mapToOrderResponse").mockReturnValue(mapped as never);

    const res = ReviewMapperUtil.mapToMyReviewResponse(review as never);

    expect(spy).toHaveBeenCalledWith(order);
    expect(res.order).toBe(mapped);
    expect(res.productName).toBe("주문 때 상품명");
  });

  it("공개 후기 목록 쿼리는 주문을 읽어 오지 않는다", async () => {
    const prisma = mockDeep<PrismaService>();
    prisma.product.findUnique.mockResolvedValue({ id: "product-1" } as never);
    prisma.store.findUnique.mockResolvedValue({ id: "store-1" } as never);
    prisma.productReview.count.mockResolvedValue(0);
    prisma.productReview.findMany.mockResolvedValue([]);
    const service = new ReviewListService(prisma);

    await service.getProductReviewsForUser("product-1", {
      page: 1,
      limit: 10,
      sortBy: ReviewSortBy.LATEST,
    });
    await service.getStoreReviewsForUser("store-1", {
      page: 1,
      limit: 10,
      sortBy: ReviewSortBy.LATEST,
    });

    for (const [args] of prisma.productReview.findMany.mock.calls) {
      expect(args?.include).not.toHaveProperty("order");
    }
    expect(prisma.productReview.findMany).toHaveBeenCalledTimes(2);
  });
});
