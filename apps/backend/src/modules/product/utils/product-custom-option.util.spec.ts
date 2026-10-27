import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  CustomOptionType,
  EnableStatus,
  ProductCategoryType,
  ProductType,
} from "@apps/backend/modules/product/constants/product.constants";
import { CustomOptionDto } from "@apps/backend/modules/product/dto/product-create.dto";

import {
  canonicalJson,
  deriveLegacyOptionFields,
  normalizeCustomOptionsForSave,
  syncCustomCategory,
  toVisibleCustomOptions,
} from "./product-custom-option.util";

const selectOption = (overrides: Partial<CustomOptionDto> = {}): CustomOptionDto => ({
  type: CustomOptionType.SINGLE_SELECT,
  name: "초 추가",
  required: false,
  visible: EnableStatus.ENABLE,
  choices: [
    { label: "없음", price: 0, visible: EnableStatus.ENABLE },
    { label: "큰초", price: 1000, visible: EnableStatus.ENABLE },
  ],
  ...overrides,
});

describe("normalizeCustomOptionsForSave", () => {
  it("새 옵션·옵션값에 ID를 발급하고, 기존 ID는 유지한다", () => {
    const [created] = normalizeCustomOptionsForSave([selectOption()], []);
    expect(created.id).toMatch(/^opt_[0-9a-f]{12}$/);
    expect(created.choices?.every((choice) => /^choice_[0-9a-f]{12}$/.test(choice.id))).toBe(true);

    const [updated] = normalizeCustomOptionsForSave(
      [
        selectOption({
          id: created.id,
          name: "초",
          choices: [
            {
              id: created.choices![1].id,
              label: "큰초",
              price: 1500,
              visible: EnableStatus.ENABLE,
            },
            { id: "choice_unknown", label: "숫자초", price: 0, visible: EnableStatus.ENABLE },
          ],
        }),
      ],
      [created],
    );
    expect(updated.id).toBe(created.id);
    expect(updated.choices![0].id).toBe(created.choices![1].id);
    // 기존에 없던 ID는 새로 발급
    expect(updated.choices![1].id).not.toBe("choice_unknown");
  });

  it("형식과 무관한 필드는 저장하지 않는다", () => {
    const [text] = normalizeCustomOptionsForSave(
      [
        {
          type: CustomOptionType.TEXT,
          name: "레터링 문구",
          required: true,
          visible: EnableStatus.ENABLE,
          maxLength: 10,
          maxCount: 3,
          choices: [{ label: "x", price: 100, visible: EnableStatus.ENABLE }],
        },
      ],
      [],
    );
    expect(text).toEqual({
      id: text.id,
      type: CustomOptionType.TEXT,
      name: "레터링 문구",
      required: true,
      visible: EnableStatus.ENABLE,
      maxLength: 10,
    });
  });

  it.each([
    ["옵션명 중복", [selectOption(), selectOption()]],
    ["사이즈·맛과 같은 이름", [selectOption({ name: "사이즈" })]],
    ["옵션값 없음", [selectOption({ choices: [] })]],
    [
      "옵션값 이름 중복",
      [
        selectOption({
          choices: [
            { label: "큰초", price: 0, visible: EnableStatus.ENABLE },
            { label: "큰초", price: 0, visible: EnableStatus.ENABLE },
          ],
        }),
      ],
    ],
    [
      "필수인데 노출 옵션값 없음 (아무도 주문 못 함)",
      [
        selectOption({
          required: true,
          choices: [{ label: "큰초", price: 0, visible: EnableStatus.DISABLE }],
        }),
      ],
    ],
    [
      "최대 선택 개수가 옵션값보다 많음",
      [selectOption({ type: CustomOptionType.MULTI_SELECT, maxSelect: 3 })],
    ],
    [
      "직접입력형 최대 글자 수 없음",
      [{ type: CustomOptionType.TEXT, name: "문구", required: true, visible: EnableStatus.ENABLE }],
    ],
    [
      "사진첨부형 2개",
      [
        {
          type: CustomOptionType.IMAGE,
          name: "사진1",
          required: false,
          visible: EnableStatus.ENABLE,
          maxCount: 1,
        },
        {
          type: CustomOptionType.IMAGE,
          name: "사진2",
          required: false,
          visible: EnableStatus.ENABLE,
          maxCount: 1,
        },
      ],
    ],
  ] as [string, CustomOptionDto[]][])("%s이면 거절한다", (_label, input) => {
    expect(() => normalizeCustomOptionsForSave(input, [])).toThrow(BadRequestException);
  });

  it("숨김 처리한 필수 옵션은 노출 옵션값이 없어도 저장할 수 있다", () => {
    expect(() =>
      normalizeCustomOptionsForSave(
        [
          selectOption({
            required: true,
            visible: EnableStatus.DISABLE,
            choices: [{ label: "큰초", price: 0, visible: EnableStatus.DISABLE }],
          }),
        ],
        [],
      ),
    ).not.toThrow();
  });
});

describe("toVisibleCustomOptions", () => {
  it("숨김 옵션과 숨김 옵션값을 제거한다", () => {
    const options = normalizeCustomOptionsForSave(
      [
        selectOption({
          choices: [
            { label: "없음", price: 0, visible: EnableStatus.ENABLE },
            { label: "큰초", price: 1000, visible: EnableStatus.DISABLE },
          ],
        }),
        selectOption({ name: "포장", visible: EnableStatus.DISABLE }),
      ],
      [],
    );
    const visible = toVisibleCustomOptions(options);
    expect(visible).toHaveLength(1);
    expect(visible[0].choices?.map((choice) => choice.label)).toEqual(["없음"]);
  });
});

describe("deriveLegacyOptionFields", () => {
  it("노출 중인 직접입력형·사진첨부형으로 레거시 값을 계산한다", () => {
    const options = normalizeCustomOptionsForSave(
      [
        {
          type: CustomOptionType.TEXT,
          name: "레터링 문구",
          required: true,
          visible: EnableStatus.ENABLE,
          maxLength: 12,
        },
        {
          type: CustomOptionType.IMAGE,
          name: "참고사진",
          required: false,
          visible: EnableStatus.DISABLE,
          maxCount: 3,
        },
      ],
      [],
    );
    expect(deriveLegacyOptionFields(options)).toEqual({
      letteringVisible: EnableStatus.ENABLE,
      letteringMaxLength: 12,
      imageUploadEnabled: EnableStatus.DISABLE,
    });
  });
});

describe("syncCustomCategory", () => {
  it("상품 유형이 커스텀이면 카테고리 '커스텀'을 넣고, 기본이면 뺀다", () => {
    expect(syncCustomCategory([ProductCategoryType.BIRTHDAY], ProductType.CUSTOM_CAKE)).toEqual([
      ProductCategoryType.BIRTHDAY,
      ProductCategoryType.LETTERING,
    ]);
    expect(
      syncCustomCategory(
        [ProductCategoryType.LETTERING, ProductCategoryType.BIRTHDAY],
        ProductType.BASIC_CAKE,
      ),
    ).toEqual([ProductCategoryType.BIRTHDAY]);
  });
});

describe("canonicalJson", () => {
  it("키 순서가 달라도 같은 값이면 같은 문자열을 만든다", () => {
    expect(canonicalJson([{ b: 1, a: { d: 2, c: 3 } }])).toBe(
      canonicalJson([{ a: { c: 3, d: 2 }, b: 1 }]),
    );
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});
