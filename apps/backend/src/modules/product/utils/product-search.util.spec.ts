import { describe, expect, it } from "vitest";

import {
  ProductCategoryType,
  ProductOrderMethod,
} from "@apps/backend/modules/product/constants/product.constants";
import {
  buildProductKeywordOrConditions,
  buildProductKeywordSearchSqlCondition,
} from "@apps/backend/modules/product/utils/product-search.util";

describe("검색어가 당일픽업 분류로 이어질 때(기획 I-01)", () => {
  it("손님 목록은 당일픽업 줄에 예약 받기 상품만", () => {
    const conditions = buildProductKeywordOrConditions("당일픽업", { customerList: true });
    expect(conditions).toContainEqual({
      productCategoryTypes: { has: ProductCategoryType.SAME_DAY_PICKUP },
      orderMethod: ProductOrderMethod.RESERVATION,
    });
  });

  it("사장님 목록은 분류 그대로", () => {
    const conditions = buildProductKeywordOrConditions("당일픽업");
    expect(conditions).toContainEqual({
      productCategoryTypes: { has: ProductCategoryType.SAME_DAY_PICKUP },
    });
  });

  it("다른 분류로 이어지는 검색어는 주문 방법을 보지 않는다", () => {
    const conditions = buildProductKeywordOrConditions("생일", { customerList: true });
    expect(conditions.some((c) => "orderMethod" in c)).toBe(false);
  });

  it("SQL 조건도 손님 목록이면 order_method를 본다", () => {
    const customer = buildProductKeywordSearchSqlCondition("당일", "p", { customerList: true });
    const seller = buildProductKeywordSearchSqlCondition("당일", "p");
    expect(customer.sql).toContain("p.order_method");
    expect(customer.values).toContain(ProductOrderMethod.RESERVATION);
    expect(seller.sql).not.toContain("order_method");
  });
});
