import { describe, expect, it } from "vitest";
import {
  detectLengthCm,
  detectSizeDisplayName,
  toNaverProductSuggestion,
} from "@apps/backend/modules/naver-place/utils/naver-product-suggestion.util";
import { NAVER_PRODUCT_WARNINGS } from "@apps/backend/modules/naver-place/constants/naver-booking.constants";
import { CakeSizeDisplayName } from "@apps/backend/modules/product/constants/product.constants";
import type {
  NaverBookingItem,
  NaverBookingOption,
} from "@apps/backend/modules/naver-place/utils/naver-booking-parser.util";

const item = (over: Partial<NaverBookingItem> = {}): NaverBookingItem => ({
  bizItemId: "1001",
  name: "샘플 생크림 케이크",
  desc: "샘플 설명",
  price: 0,
  subType: "RESTAURANT_PICKUP",
  requiresOption: true,
  isClosed: false,
  precautions: [{ title: "주의", desc: "3일 전까지 취소" }],
  imageUrls: [],
  ...over,
});

const option = (over: Partial<NaverBookingOption>): NaverBookingOption => ({
  optionId: "1",
  categoryName: null,
  name: "옵션",
  desc: null,
  price: 0,
  normalPrice: null,
  isSoldOut: false,
  remainStock: null,
  ...over,
});

describe("detectSizeDisplayName", () => {
  it("이름에 사이즈가 하나만 있을 때만 찾는다", () => {
    expect(detectSizeDisplayName("샘플 케이크 1호")).toBe(CakeSizeDisplayName.SIZE_1);
    expect(detectSizeDisplayName("미니 사이즈")).toBe(CakeSizeDisplayName.MINI);
    expect(detectSizeDisplayName("도시락 케이크")).toBe(CakeSizeDisplayName.DOSIRAK);
    expect(detectSizeDisplayName("10호 특대")).toBeNull();
    expect(detectSizeDisplayName("1호 또는 2호")).toBeNull();
    expect(detectSizeDisplayName("보냉백")).toBeNull();
  });
});

describe("detectLengthCm", () => {
  it("지름이 적혀 있을 때만 쓴다", () => {
    expect(detectLengthCm("1호", "1호 사이즈 지름15cm(초 별도)")).toBe(15);
    expect(detectLengthCm("미니", "약 12 cm")).toBe(12);
    expect(detectLengthCm("1호", "15cm, 18cm 중 선택")).toBeNull();
    expect(detectLengthCm("1호", null)).toBeNull();
  });
});

describe("toNaverProductSuggestion", () => {
  it("사이즈 옵션은 사이즈로, 나머지는 추가 옵션으로 제안한다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ optionId: "1", name: "보냉백+아이스팩", price: 2000 }),
      option({ optionId: "2", name: "샘플 케이크 1호", price: 54000, desc: "지름15cm" }),
      option({ optionId: "3", name: "샘플 케이크 미니", price: 38000, desc: "지름12cm" }),
    ]);
    expect(
      s.options.map((o) => [o.name, o.role, o.sizeDisplayName, o.lengthCm, o.selectedByDefault]),
    ).toEqual([
      ["보냉백+아이스팩", "EXTRA", null, null, true],
      ["샘플 케이크 1호", "SIZE", CakeSizeDisplayName.SIZE_1, 15, true],
      ["샘플 케이크 미니", "SIZE", CakeSizeDisplayName.MINI, 12, true],
    ]);
    expect(s.suggestedSalePrice).toBe(38000);
    expect(s.precautions).toBe("주의\n3일 전까지 취소");
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.FLAVOR_REQUIRED);
    expect(s.warnings).not.toContain(NAVER_PRODUCT_WARNINGS.PRICE_AMBIGUOUS);
  });

  it("상품 가격과 옵션 가격이 둘 다 있으면 사이즈를 고르지 않고 경고한다", () => {
    const s = toNaverProductSuggestion(item({ price: 30000 }), [
      option({ optionId: "2", name: "1호", price: 5000, desc: "지름15cm" }),
    ]);
    expect(s.options[0].selectedByDefault).toBe(false);
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.PRICE_AMBIGUOUS);
    expect(s.suggestedSalePrice).toBe(30000);
  });

  it("같은 사이즈가 여러 개면 첫 번째만 고른다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ optionId: "1", name: "초코 1호", price: 50000 }),
      option({ optionId: "2", name: "바닐라 1호", price: 50000 }),
    ]);
    expect(s.options.map((o) => o.selectedByDefault)).toEqual([true, false]);
    expect(s.options[1].invalidReason).toContain("1호");
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.LENGTH_UNKNOWN("초코 1호"));
  });

  it("추가 옵션 선택지 이름이 30자를 넘으면 고르지 않고 이유를 알려 준다", () => {
    const longName = "가".repeat(31);
    const s = toNaverProductSuggestion(item(), [option({ name: longName, price: 1000 })]);
    expect(s.options[0].selectedByDefault).toBe(false);
    expect(s.options[0].invalidReason).toContain("30자");
  });

  it("옵션을 읽지 못했으면(null) 그 이유를, 옵션이 없으면 직접 입력을 안내한다", () => {
    expect(toNaverProductSuggestion(item(), null).warnings).toContain(
      NAVER_PRODUCT_WARNINGS.OPTIONS_UNAVAILABLE,
    );
    expect(toNaverProductSuggestion(item(), []).warnings).toContain(
      NAVER_PRODUCT_WARNINGS.NO_OPTIONS,
    );
  });

  it("품절 옵션과 예약 마감 상품을 알려 준다", () => {
    const s = toNaverProductSuggestion(item({ isClosed: true }), [
      option({ name: "2호", price: 64000, isSoldOut: true }),
    ]);
    expect(s.soldOutOptionNames).toEqual(["2호"]);
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.SOLD_OUT("2호"));
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.ITEM_CLOSED);
  });
});
