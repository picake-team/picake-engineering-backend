import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ProductCategoryType as C } from "@apps/backend/modules/product/constants/product.constants";
import { GetProductsRequestDto } from "@apps/backend/modules/product/dto/product-list.dto";
import { CreateProductRequestDto } from "@apps/backend/modules/product/dto/product-create.dto";
import { UpdateProductRequestDto } from "@apps/backend/modules/product/dto/product-update.dto";
import { ProductCategoryType as PrismaProductCategoryType } from "@apps/backend/infra/database/prisma/generated/client";
import {
  PRODUCT_CATEGORY_GROUPS,
  groupProductCategoryTypes,
  normalizeProductCategoryTypes,
  productCategoryFromKeyword,
  productCategoryWhereConditions,
} from "@apps/backend/modules/product/utils/product-category.util";

describe("카테고리 묶음", () => {
  it("코드의 카테고리 값과 DB(Prisma) enum 값이 같다", () => {
    expect(Object.values(C).sort()).toEqual(Object.values(PrismaProductCategoryType).sort());
  });

  it("모든 카테고리 값이 묶음 하나에만 들어 있다", () => {
    const flat = PRODUCT_CATEGORY_GROUPS.flat();
    expect(new Set(flat).size).toBe(flat.length);
    expect([...flat].sort()).toEqual(Object.values(C).sort());
  });

  it("고른 값을 묶음별로 나누고 빈 묶음은 뺀다", () => {
    expect(
      groupProductCategoryTypes([C.CHARACTER, C.BIRTHDAY, C.COUPLE, C.SAME_DAY_PICKUP]),
    ).toEqual([[C.BIRTHDAY, C.COUPLE], [C.CHARACTER], [C.SAME_DAY_PICKUP]]);
    expect(groupProductCategoryTypes([])).toEqual([]);
    expect(groupProductCategoryTypes(undefined)).toEqual([]);
  });

  it("하트·2단은 디자인 묶음(11-15 모양 묶음을 합침)", () => {
    expect(groupProductCategoryTypes([C.HEART, C.LETTERING, C.TWO_TIER, C.BIRTHDAY])).toEqual([
      [C.BIRTHDAY],
      [C.HEART, C.LETTERING, C.TWO_TIER],
    ]);
  });

  it("Prisma 조건: 묶음마다 hasSome, 묶음끼리 AND(목록)", () => {
    expect(productCategoryWhereConditions([C.BIRTHDAY, C.CHARACTER, C.FLOWER])).toEqual([
      { productCategoryTypes: { hasSome: [C.BIRTHDAY] } },
      { productCategoryTypes: { hasSome: [C.CHARACTER, C.FLOWER] } },
    ]);
  });
});

describe("옛 카테고리 값", () => {
  it("연인·기념일·가족·친구를 새 값으로 바꾸고 겹친 것은 하나만 남긴다", () => {
    expect(
      normalizeProductCategoryTypes(["LOVER", "ANNIVERSARY", "FAMILY", "FRIEND", "BIRTHDAY"]),
    ).toEqual([C.COUPLE, C.THANKS, C.BIRTHDAY]);
  });

  it("없앤 값(빈티지·입체)은 조용히 뺀다", async () => {
    expect(normalizeProductCategoryTypes(["VINTAGE", "SCULPTED", "BIRTHDAY"])).toEqual([
      C.BIRTHDAY,
    ]);
    const dto = plainToInstance(GetProductsRequestDto, { productCategoryTypes: "VINTAGE" });
    expect(dto.productCategoryTypes).toEqual([]);
    expect((await validate(dto)).filter((e) => e.property === "productCategoryTypes")).toEqual([]);
  });

  it("Object 기본 이름(constructor 등)은 옛 값으로 보지 않는다", () => {
    expect(normalizeProductCategoryTypes(["constructor", "toString"])).toEqual([
      "constructor",
      "toString",
    ]);
  });

  it("모르는 값은 그대로 두어 검사에서 막힌다", async () => {
    const dto = plainToInstance(GetProductsRequestDto, { productCategoryTypes: ["NOPE"] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "productCategoryTypes")).toBe(true);
  });

  it("상품 등록·수정 본문의 옛 값도 새 값으로 바꾸고 겹친 것을 지운다(레터링은 보낸 그대로)", () => {
    const created = plainToInstance(CreateProductRequestDto, {
      productCategoryTypes: ["LOVER", "ANNIVERSARY", "LETTERING", "LETTERING"],
    });
    expect(created.productCategoryTypes).toEqual([C.COUPLE, C.LETTERING]);
    // 수정: 빈 배열은 "전부 지우기"로 그대로, 안 보내면 바꾸지 않음(undefined)
    expect(
      plainToInstance(UpdateProductRequestDto, { productCategoryTypes: [] }).productCategoryTypes,
    ).toEqual([]);
    expect(plainToInstance(UpdateProductRequestDto, {}).productCategoryTypes).toBeUndefined();
  });

  it("목록 요청에 옛 값 하나가 와도(쿼리 문자열) 새 값 배열로 받는다", async () => {
    const dto = plainToInstance(GetProductsRequestDto, { productCategoryTypes: "LOVER" });
    expect(dto.productCategoryTypes).toEqual([C.COUPLE]);
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === "productCategoryTypes")).toEqual([]);
  });
});

describe("검색어 → 같은 뜻 카테고리", () => {
  it.each([
    ["연인", C.COUPLE],
    ["남친", C.COUPLE],
    ["100일", C.COUPLE],
    ["결혼 기념일", C.COUPLE],
    ["엄마", C.THANKS],
    ["선생님", C.THANKS],
    ["친구 케이크", C.BIRTHDAY],
    ["생일케이크", C.BIRTHDAY],
    ["#레터링", C.LETTERING],
    ["레터링케이크", C.LETTERING],
    ["돌잔치", C.BABY],
    ["합격", C.CONGRATS],
    ["프로포즈", C.WEDDING],
    ["크리스마스", C.SEASON],
    ["2단", C.TWO_TIER],
  ])("%s → %s", (keyword, category) => {
    expect(productCategoryFromKeyword(keyword)).toBe(category);
  });

  it("카테고리와 상관없는 말은 잇지 않는다", () => {
    expect(productCategoryFromKeyword("곰돌이")).toBeUndefined();
    expect(productCategoryFromKeyword("케이크")).toBeUndefined();
    // 없앤 카테고리 말은 이름 검색으로만 찾는다
    expect(productCategoryFromKeyword("빈티지")).toBeUndefined();
    expect(productCategoryFromKeyword("입체")).toBeUndefined();
    expect(productCategoryFromKeyword("  ")).toBeUndefined();
  });
});
