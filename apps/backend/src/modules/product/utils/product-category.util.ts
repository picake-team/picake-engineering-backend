import { Transform } from "class-transformer";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { ProductCategoryType } from "@apps/backend/modules/product/constants/product.constants";

const C = ProductCategoryType;

/**
 * 카테고리 묶음(질문 하나에 묶음 하나). 거를 때 묶음 안은 "또는", 묶음끼리는 "그리고".
 * 예: 생일 + 캐릭터 = 생일에 맞는 캐릭터 케이크만, 생일 + 연인·기념일 = 둘 중 하나.
 * 웹(손님 필터·사장님 고르기)의 묶음과 같은 순서로 둔다.
 */
export const PRODUCT_CATEGORY_GROUPS: readonly (readonly ProductCategoryType[])[] = [
  // 상황: 무슨 날, 누구에게
  [C.BIRTHDAY, C.COUPLE, C.THANKS, C.BABY, C.CONGRATS, C.WEDDING, C.SEASON],
  // 디자인: 어떻게 꾸몄나
  [C.LETTERING, C.DRAWING, C.PHOTO, C.CHARACTER, C.FLOWER, C.RIBBON, C.FRUIT, C.VINTAGE, C.SIMPLE],
  // 모양: 기본 원형이 아닐 때
  [C.HEART, C.SCULPTED, C.TWO_TIER],
  // 서비스
  [C.SAME_DAY_PICKUP],
];

/**
 * 11-15 전 값 → 새 값. 공유된 옛 주소·배포 사이에 옛 화면이 보내는 값을 받아 준다
 * (DB 값은 migration 20261115120000에서 같은 규칙으로 옮겼다).
 */
export const LEGACY_PRODUCT_CATEGORY_MAP: Readonly<Record<string, ProductCategoryType>> = {
  LOVER: C.COUPLE,
  ANNIVERSARY: C.COUPLE,
  FAMILY: C.THANKS,
  FRIEND: C.BIRTHDAY,
};

/**
 * 요청 값의 옛 카테고리를 새 값으로 바꾸고 겹친 것을 지운다. 모르는 값은 그대로 두어 검사(IsEnum)가 막게 한다.
 */
export function normalizeProductCategoryTypes(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  // Set으로 겹친 것을 지운다(긴 배열이 와도 한 번만 훑는다). 처음 나온 순서는 지킨다
  const out = new Set<unknown>();
  for (const item of value) {
    const isLegacy =
      typeof item === "string" &&
      Object.prototype.hasOwnProperty.call(LEGACY_PRODUCT_CATEGORY_MAP, item);
    out.add(isLegacy ? LEGACY_PRODUCT_CATEGORY_MAP[item as string] : item);
  }
  return [...out];
}

/**
 * 요청 DTO의 카테고리 배열 변환: 하나만 오면(쿼리 ?productCategoryTypes=BIRTHDAY) 배열로, 옛 값은 새 값으로.
 * 빈 배열은 그대로 둔다(상품 수정에서 "전부 지우기").
 */
export function ProductCategoryTypesTransform() {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === "") return undefined;
    return normalizeProductCategoryTypes(Array.isArray(value) ? value : [value]);
  });
}

/** 고른 카테고리를 묶음별로 나눈다(빈 묶음은 뺀다). 어느 묶음에도 없는 값은 따로 한 묶음 */
export function groupProductCategoryTypes(
  types: readonly ProductCategoryType[] | undefined,
): ProductCategoryType[][] {
  if (!types?.length) return [];
  const groups = PRODUCT_CATEGORY_GROUPS.map((group) =>
    types.filter((t) => group.includes(t)),
  ).filter((g) => g.length > 0);
  const known = new Set(PRODUCT_CATEGORY_GROUPS.flat());
  const unknown = types.filter((t) => !known.has(t));
  return unknown.length > 0 ? [...groups, unknown] : groups;
}

/** Prisma 상품 조건: 묶음마다 hasSome, 묶음끼리 AND */
export function productCategoryWhereConditions(
  types: readonly ProductCategoryType[] | undefined,
): Prisma.ProductWhereInput[] {
  return groupProductCategoryTypes(types).map((group) => ({
    productCategoryTypes: { hasSome: group },
  }));
}

/** Raw SQL 상품 조건: 묶음마다 배열 겹침(&&), 묶음끼리 AND(조건 목록에 하나씩 넣는다) */
export function productCategorySqlConditions(
  types: readonly ProductCategoryType[] | undefined,
  tableAlias = "p",
): Prisma.Sql[] {
  const column = Prisma.raw(`${tableAlias}.product_category_types`);
  return groupProductCategoryTypes(types).map(
    (group) => Prisma.sql`${column}::text[] && ARRAY[${Prisma.join(group)}]::text[]`,
  );
}

/**
 * 검색어와 같은 뜻의 카테고리(검색어 → 그 카테고리 상품도 찾는다).
 * 손님이 실제로 친 말(연인·100일·친구 케이크·생일케이크 등)과 "누구에게"(엄마·남친·선생님)를 상황으로 잇는다.
 */
const KEYWORD_CATEGORY: ReadonlyArray<readonly [ProductCategoryType, readonly string[]]> = [
  [C.BIRTHDAY, ["생일", "생신", "생파", "생일파티", "벌스데이", "친구"]],
  [
    C.COUPLE,
    [
      "연인",
      "연인기념일",
      "커플",
      "기념일",
      "남친",
      "여친",
      "남자친구",
      "여자친구",
      "애인",
      "100일",
      "200일",
      "300일",
      "1주년",
      "주년",
      "결혼기념일",
    ],
  ],
  [
    C.THANKS,
    [
      "부모님",
      "부모님감사",
      "엄마",
      "아빠",
      "어머니",
      "아버지",
      "어버이날",
      "스승의날",
      "선생님",
      "감사",
      "환갑",
      "칠순",
      "팔순",
      "효도",
    ],
  ],
  [C.BABY, ["백일", "백일돌", "돌", "첫돌", "돌잔치", "백일상", "돌상"]],
  [
    C.CONGRATS,
    ["축하", "합격", "승진", "전역", "개업", "졸업", "입학", "취업", "퇴사", "은퇴", "퇴임"],
  ],
  [C.WEDDING, ["결혼", "결혼프로포즈", "웨딩", "프로포즈", "청혼", "약혼", "브라이덜샤워"]],
  [C.SEASON, ["시즌", "크리스마스", "성탄절", "연말"]],
  [C.LETTERING, ["레터링", "문구"]],
  [C.DRAWING, ["드로잉", "그림"]],
  [C.PHOTO, ["사진", "포토"]],
  [C.CHARACTER, ["캐릭터"]],
  [C.FLOWER, ["꽃", "플라워"]],
  [C.RIBBON, ["리본"]],
  [C.FRUIT, ["과일", "생과일"]],
  [C.VINTAGE, ["빈티지"]],
  [C.SIMPLE, ["심플"]],
  [C.HEART, ["하트"]],
  [C.SCULPTED, ["입체", "3d"]],
  [C.TWO_TIER, ["2단", "이단"]],
  [C.SAME_DAY_PICKUP, ["당일픽업", "당일"]],
];

const KEYWORD_TO_CATEGORY = new Map<string, ProductCategoryType>(
  KEYWORD_CATEGORY.flatMap(([category, words]) => words.map((w) => [w, category] as const)),
);

/** 검색어 맞추기용: 앞 #·띄어쓰기·가운뎃점을 빼고 끝 "케이크"를 뗀다("친구 케이크" → "친구") */
export function normalizeCategoryKeyword(keyword: string): string {
  const compact = keyword.trim().replace(/^#/, "").replace(/[\s·]/g, "").toLowerCase();
  const withoutCake = compact.replace(/케이크$/, "");
  return withoutCake || compact;
}

export function productCategoryFromKeyword(keyword: string): ProductCategoryType | undefined {
  const key = normalizeCategoryKeyword(keyword);
  return key ? KEYWORD_TO_CATEGORY.get(key) : undefined;
}
