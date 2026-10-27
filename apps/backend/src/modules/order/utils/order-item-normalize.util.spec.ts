import { BadRequestException, ConflictException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CreateOrderItemDto } from "@apps/backend/modules/order/dto/order-create.dto";
import { ORDER_ERROR_MESSAGES } from "@apps/backend/modules/order/constants/order.constants";
import {
  CustomOptionType,
  EnableStatus,
} from "@apps/backend/modules/product/constants/product.constants";

import {
  assertProductOptionsVersion,
  buildOrderItemNormalizeContext,
  validateAndNormalizeOrderItem,
} from "./order-item-normalize.util";

const UPLOAD_URL = "https://cdn.picake.test/uploads/a.png";
const UPLOAD_URL_2 = "https://cdn.picake.test/uploads/b.png";

const PRODUCT = {
  salePrice: 30000,
  cakeSizeOptions: [
    { id: "size_mini", visible: EnableStatus.ENABLE, displayName: "미니", lengthCm: 10, price: 0 },
    { id: "size_1", visible: EnableStatus.ENABLE, displayName: "1호", lengthCm: 15, price: 5000 },
    { id: "size_hidden", visible: EnableStatus.DISABLE, displayName: "2호", price: 9000 },
  ],
  cakeFlavorOptions: [
    { id: "flavor_choco", visible: EnableStatus.ENABLE, displayName: "초코", price: 0 },
    { id: "flavor_hidden", visible: EnableStatus.DISABLE, displayName: "말차", price: 2000 },
  ],
  customOptions: [
    {
      id: "opt_candle",
      type: CustomOptionType.SINGLE_SELECT,
      name: "초 추가",
      required: false,
      visible: EnableStatus.ENABLE,
      choices: [
        { id: "c_none", label: "없음", price: 0, visible: EnableStatus.ENABLE },
        { id: "c_big", label: "큰초", price: 1000, visible: EnableStatus.ENABLE },
        { id: "c_hidden", label: "숫자초", price: 1500, visible: EnableStatus.DISABLE },
      ],
    },
    {
      id: "opt_topping",
      type: CustomOptionType.MULTI_SELECT,
      name: "토핑",
      required: false,
      visible: EnableStatus.ENABLE,
      maxSelect: 2,
      choices: [
        { id: "t_berry", label: "딸기", price: 2000, visible: EnableStatus.ENABLE },
        { id: "t_blue", label: "블루베리", price: 2500, visible: EnableStatus.ENABLE },
        { id: "t_mango", label: "망고", price: 3000, visible: EnableStatus.ENABLE },
      ],
    },
    {
      id: "opt_lettering",
      type: CustomOptionType.TEXT,
      name: "레터링 문구",
      required: true,
      visible: EnableStatus.ENABLE,
      maxLength: 5,
    },
    {
      id: "opt_image",
      type: CustomOptionType.IMAGE,
      name: "참고사진",
      required: false,
      visible: EnableStatus.ENABLE,
      maxCount: 2,
    },
    {
      id: "opt_hidden",
      type: CustomOptionType.TEXT,
      name: "숨김 문구",
      required: true,
      visible: EnableStatus.DISABLE,
      maxLength: 10,
    },
  ],
};

const context = () => buildOrderItemNormalizeContext(PRODUCT);

function item(overrides: Partial<CreateOrderItemDto> = {}): CreateOrderItemDto {
  return {
    sizeId: "size_mini",
    flavorId: "flavor_choco",
    quantity: 1,
    options: [{ optionId: "opt_lettering", text: "축하해" }],
    ...overrides,
  } as CreateOrderItemDto;
}

function expectBadRequest(fn: () => unknown, message: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(message);
    return;
  }
  throw new Error("BadRequestException이 발생하지 않았습니다");
}

describe("validateAndNormalizeOrderItem - 추가 옵션", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CLOUDFRONT_DOMAIN = "cdn.picake.test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("선택형·다중선택형 금액을 합산하고 판매자가 정한 순서로 스냅샷을 만든다", () => {
    const result = validateAndNormalizeOrderItem(
      item({
        sizeId: "size_1",
        options: [
          { optionId: "opt_lettering", text: "  축하해  " },
          { optionId: "opt_topping", choiceIds: ["t_blue", "t_berry"] },
          { optionId: "opt_candle", choiceIds: ["c_big"] },
        ],
      }),
      context(),
    );

    expect(result.optionsPrice).toBe(1000 + 2000 + 2500);
    expect(result.itemPrice).toBe(30000 + 5000 + 0 + 5500);
    expect(result.selectedOptions).toEqual([
      {
        optionId: "opt_candle",
        type: CustomOptionType.SINGLE_SELECT,
        name: "초 추가",
        choices: [{ id: "c_big", label: "큰초", price: 1000 }],
        price: 1000,
      },
      {
        optionId: "opt_topping",
        type: CustomOptionType.MULTI_SELECT,
        name: "토핑",
        choices: [
          { id: "t_berry", label: "딸기", price: 2000 },
          { id: "t_blue", label: "블루베리", price: 2500 },
        ],
        price: 4500,
      },
      {
        optionId: "opt_lettering",
        type: CustomOptionType.TEXT,
        name: "레터링 문구",
        text: "축하해",
        price: 0,
      },
    ]);
    // 레거시 컬럼에도 첫 직접입력형 값을 기록
    expect(result.letteringMessage).toBe("축하해");
  });

  it("필수 옵션이 빠지면 거절한다 (공백 문구도 빠진 것으로 본다)", () => {
    expectBadRequest(
      () => validateAndNormalizeOrderItem(item({ options: [] }), context()),
      ORDER_ERROR_MESSAGES.REQUIRED_OPTION_MISSING,
    );
    expectBadRequest(
      () =>
        validateAndNormalizeOrderItem(
          item({ options: [{ optionId: "opt_lettering", text: "   " }] }),
          context(),
        ),
      ORDER_ERROR_MESSAGES.REQUIRED_OPTION_MISSING,
    );
  });

  it("숨김 옵션·숨김 옵션값·없는 옵션은 거절하고, 숨김 필수 옵션은 요구하지 않는다", () => {
    for (const options of [
      [{ optionId: "opt_hidden", text: "a" }],
      [{ optionId: "opt_candle", choiceIds: ["c_hidden"] }],
      [{ optionId: "opt_unknown", text: "a" }],
    ]) {
      expectBadRequest(
        () =>
          validateAndNormalizeOrderItem(
            item({ options: [{ optionId: "opt_lettering", text: "축하해" }, ...options] }),
            context(),
          ),
        ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION,
      );
    }
  });

  it("같은 옵션을 두 번 보내거나 선택 개수를 넘기면 거절한다", () => {
    for (const options of [
      [
        { optionId: "opt_candle", choiceIds: ["c_big"] },
        { optionId: "opt_candle", choiceIds: ["c_none"] },
      ],
      [{ optionId: "opt_candle", choiceIds: ["c_big", "c_none"] }],
      [{ optionId: "opt_topping", choiceIds: ["t_berry", "t_blue", "t_mango"] }],
      [{ optionId: "opt_topping", choiceIds: ["t_berry", "t_berry"] }],
      [{ optionId: "opt_candle", text: "형식이 다른 값" }],
    ]) {
      expectBadRequest(
        () =>
          validateAndNormalizeOrderItem(
            item({ options: [{ optionId: "opt_lettering", text: "축하해" }, ...options] }),
            context(),
          ),
        ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION,
      );
    }
  });

  it("최대 글자 수를 넘기면 거절한다", () => {
    expectBadRequest(
      () =>
        validateAndNormalizeOrderItem(
          item({ options: [{ optionId: "opt_lettering", text: "여섯글자문구" }] }),
          context(),
        ),
      ORDER_ERROR_MESSAGES.INVALID_OPTION_TEXT,
    );
  });

  it("업로드 서비스가 발급하지 않은 URL이나 최대 장수를 넘는 사진은 거절한다", () => {
    for (const imageUrls of [
      ["https://evil.example.com/a.png"],
      [UPLOAD_URL, UPLOAD_URL_2, "https://cdn.picake.test/uploads/c.png"],
      [UPLOAD_URL, UPLOAD_URL],
    ]) {
      expectBadRequest(
        () =>
          validateAndNormalizeOrderItem(
            item({
              options: [
                { optionId: "opt_lettering", text: "축하해" },
                { optionId: "opt_image", imageUrls },
              ],
            }),
            context(),
          ),
        ORDER_ERROR_MESSAGES.INVALID_OPTION_IMAGE,
      );
    }

    const ok = validateAndNormalizeOrderItem(
      item({
        options: [
          { optionId: "opt_lettering", text: "축하해" },
          { optionId: "opt_image", imageUrls: [UPLOAD_URL, UPLOAD_URL_2] },
        ],
      }),
      context(),
    );
    expect(ok.imageUrls).toEqual([UPLOAD_URL, UPLOAD_URL_2]);
  });

  it("노출 중인 사이즈·맛이 있으면 선택해야 하고, 숨김 사이즈·맛은 고를 수 없다", () => {
    expectBadRequest(
      () => validateAndNormalizeOrderItem(item({ sizeId: undefined }), context()),
      ORDER_ERROR_MESSAGES.SIZE_REQUIRED,
    );
    expectBadRequest(
      () => validateAndNormalizeOrderItem(item({ flavorId: undefined }), context()),
      ORDER_ERROR_MESSAGES.FLAVOR_REQUIRED,
    );
    expectBadRequest(
      () => validateAndNormalizeOrderItem(item({ sizeId: "size_hidden" }), context()),
      ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS,
    );
    expectBadRequest(
      () => validateAndNormalizeOrderItem(item({ flavorId: "flavor_hidden" }), context()),
      ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS,
    );
  });

  it("options와 레거시 필드를 함께 보내면 거절한다", () => {
    expectBadRequest(
      () => validateAndNormalizeOrderItem(item({ letteringMessage: "축하해" }), context()),
      ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS,
    );
  });
});

describe("validateAndNormalizeOrderItem - 구버전 요청(letteringMessage·imageUrls)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CLOUDFRONT_DOMAIN = "cdn.picake.test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("상품의 직접입력형·사진첨부형 옵션으로 변환한다", () => {
    const result = validateAndNormalizeOrderItem(
      item({ options: undefined, letteringMessage: "축하해", imageUrls: [UPLOAD_URL] }),
      context(),
    );

    expect(result.selectedOptions).toEqual([
      {
        optionId: "opt_lettering",
        type: CustomOptionType.TEXT,
        name: "레터링 문구",
        text: "축하해",
        price: 0,
      },
      {
        optionId: "opt_image",
        type: CustomOptionType.IMAGE,
        name: "참고사진",
        imageUrls: [UPLOAD_URL],
        price: 0,
      },
    ]);
    expect(result.letteringMessage).toBe("축하해");
    expect(result.imageUrls).toEqual([UPLOAD_URL]);
  });

  it("맞는 옵션이 없는 상품이면 레거시 스냅샷으로 보존한다 (구버전 화면은 레터링을 항상 받았음)", () => {
    const productWithoutOptions = buildOrderItemNormalizeContext({
      ...PRODUCT,
      customOptions: [],
    });
    const result = validateAndNormalizeOrderItem(
      item({ options: undefined, letteringMessage: "축하해" }),
      productWithoutOptions,
    );

    expect(result.selectedOptions).toEqual([
      {
        optionId: "legacy_lettering",
        type: CustomOptionType.TEXT,
        name: "레터링 문구",
        text: "축하해",
        price: 0,
      },
    ]);
    expect(result.optionsPrice).toBe(0);
  });
});

describe("assertProductOptionsVersion", () => {
  it("버전이 다르면 409, 같거나 생략하면 통과한다", () => {
    expect(() => assertProductOptionsVersion(2, 3)).toThrow(ConflictException);
    expect(() => assertProductOptionsVersion(3, 3)).not.toThrow();
    expect(() => assertProductOptionsVersion(undefined, 3)).not.toThrow();
  });
});
