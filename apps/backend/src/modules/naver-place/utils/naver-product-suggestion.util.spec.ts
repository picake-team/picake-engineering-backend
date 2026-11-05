import { describe, expect, it } from "vitest";
import {
  NAVER_EXTRA_GROUP_NAME,
  detectLengthCm,
  detectSizeDisplayName,
  toNaverOptionProductSuggestion,
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
  imageUrl: null,
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

  // 아래는 여러 매장을 조사해 본 네이버 예약 형식을 본뜬 예시 (실제 매장 데이터 아님)
  it("분류 이름이 '사이즈'면 이름에 호수가 없어도 사이즈로 보고, 표시명은 판매자가 고르게 한다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ optionId: "1", categoryName: "케이크 사이즈 선택", name: "1호", price: 40000 }),
      option({ optionId: "2", categoryName: "케이크 사이즈 선택", name: "S (12cm)", price: 30000 }),
    ]);
    expect(s.options.map((o) => [o.role, o.sizeDisplayName, o.selectedByDefault])).toEqual([
      ["SIZE", CakeSizeDisplayName.SIZE_1, true],
      ["SIZE", null, false],
    ]);
    expect(s.options[1].invalidReason).toContain("사이즈");
  });

  it("분류 이름이 '맛'이면 '맛'이라는 필수 추가 옵션(하나 고르기)으로 제안한다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ optionId: "1", name: "샘플 케이크 1호", price: 50000 }),
      option({ optionId: "2", categoryName: "케이크 맛 선택", name: "초코", price: 0 }),
      option({ optionId: "3", categoryName: "맛", name: "얼그레이", price: 2000 }),
    ]);
    expect(s.options.map((o) => [o.role, o.groupName, o.groupRequired])).toEqual([
      ["SIZE", NAVER_EXTRA_GROUP_NAME, false],
      ["EXTRA", "맛", true],
      ["EXTRA", "맛", true],
    ]);
  });

  it("'맛있는'처럼 맛이 들어간 다른 말은 맛 분류로 보지 않는다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ categoryName: "맛있는 추가", name: "초", price: 500 }),
    ]);
    expect(s.options[0].role).toBe("EXTRA");
  });

  it("가격이 없는 안내 항목은 고르지 않는다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ name: "생크림 케이크는 다음 달 판매 예정입니다", price: null }),
    ]);
    expect(s.options[0].selectedByDefault).toBe(false);
    expect(s.options[0].invalidReason).toBe(NAVER_PRODUCT_WARNINGS.OPTION_NO_PRICE);
  });

  it("사이즈 없이 비싼 옵션이 여러 개면 묶음 주문서로 보고 아무것도 고르지 않는다", () => {
    const s = toNaverProductSuggestion(item({ name: "포장주문" }), [
      option({ optionId: "1", categoryName: "케이크", name: "바스크치즈케이크", price: 32000 }),
      option({ optionId: "2", categoryName: "케이크", name: "얼그레이 케이크", price: 35000 }),
      option({ optionId: "3", categoryName: "음료", name: "아메리카노", price: 4500 }),
    ]);
    expect(s.menuLike).toBe(true);
    expect(s.options.every((o) => !o.selectedByDefault)).toBe(true);
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.MENU_LIKE);
    expect(s.warnings).not.toContain(NAVER_PRODUCT_WARNINGS.NO_SIZE_OPTION);
  });

  it("추가 옵션이 20개를 넘으면 앞의 20개만 고른다", () => {
    const extras = Array.from({ length: 25 }, (_, i) =>
      option({ optionId: String(i + 1), name: `리본 ${i + 1}`, price: 500 }),
    );
    const s = toNaverProductSuggestion(item(), [option({ name: "1호", price: 40000 }), ...extras]);
    expect(s.options.filter((o) => o.role === "EXTRA" && o.selectedByDefault)).toHaveLength(20);
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.TOO_MANY_EXTRAS(20));
  });

  it("옵션을 읽을 수 없는 방식(FAILED)과 예약 가능한 날이 없음(NO_SCHEDULE)을 구분한다", () => {
    expect(toNaverProductSuggestion(item(), null, "FAILED").warnings).toContain(
      NAVER_PRODUCT_WARNINGS.OPTIONS_FAILED,
    );
    expect(toNaverProductSuggestion(item(), null, "NO_SCHEDULE").warnings).toContain(
      NAVER_PRODUCT_WARNINGS.OPTIONS_UNAVAILABLE,
    );
  });

  it("매장 방문(테이블) 예약 상품이면 알려 준다", () => {
    expect(toNaverProductSuggestion(item({ subType: "RESTAURANT_VISIT" }), []).warnings).toContain(
      NAVER_PRODUCT_WARNINGS.VISIT_ITEM,
    );
  });
});

describe("기본 가격 옵션과 추가 옵션 그룹", () => {
  it("사이즈 없이 비싼 옵션이 하나면 그 옵션이 판매가가 되고 추가 옵션으로 더하지 않는다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({
        optionId: "1",
        categoryName: "디자인케이크",
        name: "샘플 브라우니 케이크",
        price: 53000,
      }),
      option({ optionId: "2", categoryName: "디자인케이크", name: "초 추가", price: 500 }),
    ]);
    expect(s.options.map((o) => [o.role, o.groupName])).toEqual([
      ["BASE", "디자인케이크"],
      ["EXTRA", "추가 선택"],
    ]);
    expect(s.suggestedSalePrice).toBe(53000);
    expect(s.menuLike).toBe(false);
  });

  it("상품 가격이 따로 있으면 기본 가격 옵션으로 보지 않는다", () => {
    const s = toNaverProductSuggestion(item({ price: 30000 }), [
      option({ name: "샘플 케이크", price: 20000 }),
    ]);
    expect(s.options[0].role).toBe("EXTRA");
    expect(s.suggestedSalePrice).toBe(30000);
  });

  it("'(필수선택)' 분류는 필수 그룹으로, 표시는 빼고 그룹 이름으로 쓴다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ optionId: "1", name: "1호", price: 40000 }),
      option({ optionId: "2", categoryName: "포장 리본(필수선택)", name: "레드", price: 0 }),
      option({ optionId: "3", categoryName: "케이크박스 (필수 선택)", name: "원형", price: 2000 }),
      option({ optionId: "4", name: "보냉백", price: 2000 }),
    ]);
    expect(s.options.slice(1).map((o) => [o.groupName, o.groupRequired])).toEqual([
      ["포장 리본", true],
      ["케이크박스", true],
      ["추가 선택", false],
    ]);
  });
});

describe("묶음 주문서 판단 (조사한 매장 형식을 본뜬 예시)", () => {
  it("조각 케이크·커피처럼 5천 원 넘는 옵션이 3개 이상이면 묶음 주문서", () => {
    const s = toNaverProductSuggestion(item({ name: "샘플 케이크 주문" }), [
      option({ optionId: "1", categoryName: "케이크", name: "모둠조각 케이크", price: 65000 }),
      option({ optionId: "2", categoryName: "케이크", name: "얼그레이 조각", price: 8000 }),
      option({ optionId: "3", categoryName: "케이크", name: "바스크 조각", price: 8000 }),
      option({ optionId: "4", categoryName: "coffee", name: "아메리카노", price: 4500 }),
    ]);
    expect(s.menuLike).toBe(true);
    expect(s.options.some((o) => o.role === "BASE")).toBe(false);
  });

  it("이름이 '포장주문'이면 옵션이 하나여도 묶음 주문서", () => {
    const s = toNaverProductSuggestion(item({ name: "포장주문" }), [
      option({ name: "샘플 케이크", price: 68000 }),
    ]);
    expect(s.menuLike).toBe(true);
  });

  it("기본 가격 옵션은 다른 옵션보다 2배 이상 비쌀 때만", () => {
    const yes = toNaverProductSuggestion(item(), [
      option({ optionId: "1", name: "샘플 장미 케이크", price: 29000 }),
      option({ optionId: "2", name: "생화 추가", price: 8000 }),
      option({ optionId: "3", name: "초 추가", price: 2000 }),
    ]);
    expect(yes.options.map((o) => o.role)).toEqual(["BASE", "EXTRA", "EXTRA"]);
    expect(yes.suggestedSalePrice).toBe(29000);

    const no = toNaverProductSuggestion(item(), [
      option({ optionId: "1", name: "샘플 케이크 A", price: 15000 }),
      option({ optionId: "2", name: "포장 추가", price: 9000 }),
    ]);
    expect(no.options.map((o) => o.role)).toEqual(["EXTRA", "EXTRA"]);
  });

  it("계약금·개인결제창은 기본 가격으로 보지 않고 고르지 않는다", () => {
    const s = toNaverProductSuggestion(item(), [
      option({ name: "원하는 디자인(계약금)", price: 10000 }),
    ]);
    expect(s.options[0]).toMatchObject({ role: "EXTRA", selectedByDefault: false });
    expect(s.options[0].invalidReason).toBe(NAVER_PRODUCT_WARNINGS.PAYMENT_OPTION);
  });
});

describe("toNaverOptionProductSuggestion", () => {
  it("옵션 하나를 상품으로: 이름·설명·가격·사진은 옵션에서, 주의사항은 상품에서", () => {
    const s = toNaverOptionProductSuggestion(
      item({ name: "포장주문", imageUrls: ["https://a.pstatic.net/item.jpg"] }),
      option({
        name: "바스크치즈케이크",
        desc: "꾸덕한 치즈",
        price: 32000,
        imageUrl: "https://a.pstatic.net/option.jpg",
      }),
    );
    expect(s).toMatchObject({
      name: "바스크치즈케이크",
      description: "꾸덕한 치즈",
      precautions: "주의\n3일 전까지 취소",
      imageUrls: ["https://a.pstatic.net/option.jpg"],
      suggestedSalePrice: 32000,
      options: [],
    });
    expect(s.warnings[0]).toBe(NAVER_PRODUCT_WARNINGS.OPTION_AS_PRODUCT("포장주문"));
    expect(s.warnings).toContain(NAVER_PRODUCT_WARNINGS.NO_SIZE_OPTION);
  });

  it("옵션 사진이 없으면 상품 사진을 쓴다", () => {
    const s = toNaverOptionProductSuggestion(
      item({ imageUrls: ["https://a.pstatic.net/item.jpg"] }),
      option({ name: "샘플 케이크 1호", price: 40000 }),
    );
    expect(s.imageUrls).toEqual(["https://a.pstatic.net/item.jpg"]);
    expect(s.warnings).not.toContain(NAVER_PRODUCT_WARNINGS.NO_SIZE_OPTION);
  });
});
