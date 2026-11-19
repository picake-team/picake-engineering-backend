import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  CustomOptionType,
  EnableStatus,
  ProductOrderMethod,
  ProductType,
} from "@apps/backend/modules/product/constants/product.constants";
import {
  productHasExtraPrice,
  resolveProductOrderMethod,
} from "@apps/backend/modules/product/utils/product-order-method.util";

const { ENABLE, DISABLE } = EnableStatus;
const size = (price: number, visible = ENABLE) => ({
  id: `s${price}`,
  displayName: "1호",
  price,
  visible,
});
const select = (prices: number[], visible = ENABLE, choiceVisible = ENABLE) => ({
  id: "opt_1",
  type: CustomOptionType.SINGLE_SELECT,
  name: "시트",
  required: false,
  visible,
  choices: prices.map((price, i) => ({
    id: `c${i}`,
    label: `맛${i}`,
    price,
    visible: choiceVisible,
  })),
});

describe("resolveProductOrderMethod", () => {
  it("기본 케이크는 늘 예약 받기", () => {
    expect(resolveProductOrderMethod({ productType: ProductType.BASIC_CAKE })).toBe(
      ProductOrderMethod.RESERVATION,
    );
    // 커스텀 → 기본으로 바꾸면 견적이었어도 예약으로 돌아간다
    expect(
      resolveProductOrderMethod({
        productType: ProductType.BASIC_CAKE,
        current: ProductOrderMethod.QUOTE,
      }),
    ).toBe(ProductOrderMethod.RESERVATION);
  });

  it("기본 케이크 상품에 견적 받기만 따로 보내면 막는다", () => {
    expect(() =>
      resolveProductOrderMethod({
        productType: ProductType.BASIC_CAKE,
        requested: ProductOrderMethod.QUOTE,
      }),
    ).toThrow(BadRequestException);
  });

  it("커스텀 → 기본으로 바꾸며 지금 값(견적 받기)이 같이 와도 예약 받기로 돌린다", () => {
    expect(
      resolveProductOrderMethod({
        productType: ProductType.BASIC_CAKE,
        requested: ProductOrderMethod.QUOTE,
        current: ProductOrderMethod.QUOTE,
        productTypeSent: true,
      }),
    ).toBe(ProductOrderMethod.RESERVATION);
  });

  it("커스텀 케이크는 보낸 값 → 지금 값 → 예약 받기 순서", () => {
    const custom = ProductType.CUSTOM_CAKE;
    expect(resolveProductOrderMethod({ productType: custom })).toBe(ProductOrderMethod.RESERVATION);
    expect(
      resolveProductOrderMethod({ productType: custom, requested: ProductOrderMethod.QUOTE }),
    ).toBe(ProductOrderMethod.QUOTE);
    expect(
      resolveProductOrderMethod({ productType: custom, current: ProductOrderMethod.QUOTE }),
    ).toBe(ProductOrderMethod.QUOTE);
    expect(
      resolveProductOrderMethod({
        productType: custom,
        requested: ProductOrderMethod.RESERVATION,
        current: ProductOrderMethod.QUOTE,
      }),
    ).toBe(ProductOrderMethod.RESERVATION);
  });
});

describe("productHasExtraPrice", () => {
  it("크기·옵션 모두 0원이면 없음(물결 빼기)", () => {
    expect(productHasExtraPrice([size(0)], [select([0, 0])])).toBe(false);
    expect(productHasExtraPrice([size(0)], [])).toBe(false);
    expect(productHasExtraPrice(null, null)).toBe(false);
  });

  it("보이는 크기에 추가금이 있으면 있음", () => {
    expect(productHasExtraPrice([size(0), size(10000)], [])).toBe(true);
  });

  it("보이는 옵션 선택지에 추가금이 있으면 있음", () => {
    expect(productHasExtraPrice([size(0)], [select([0, 3000])])).toBe(true);
  });

  it("숨긴 크기·옵션·선택지의 추가금은 세지 않는다", () => {
    expect(productHasExtraPrice([size(0), size(10000, DISABLE)], [])).toBe(false);
    expect(productHasExtraPrice([size(0)], [select([3000], DISABLE)])).toBe(false);
    expect(productHasExtraPrice([size(0)], [select([3000], ENABLE, DISABLE)])).toBe(false);
  });

  it("형식이 깨진 값은 무시한다", () => {
    expect(productHasExtraPrice([{ visible: ENABLE, price: "1000" }, 3, null], "x")).toBe(false);
  });
});
