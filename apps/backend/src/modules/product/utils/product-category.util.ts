import { Transform } from "class-transformer";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import {
  ProductCategoryType,
  ProductOrderMethod,
} from "@apps/backend/modules/product/constants/product.constants";

const C = ProductCategoryType;

/**
 * 카테고리 묶음(질문 하나에 묶음 하나). 거를 때 묶음 안은 "또는", 묶음끼리는 "그리고".
 * 예: 생일 + 캐릭터 = 생일에 맞는 캐릭터 케이크만, 생일 + 연인·기념일 = 둘 중 하나.
 * 웹(손님 필터·사장님 고르기)의 묶음과 같은 순서로 둔다.
 */
export const PRODUCT_CATEGORY_GROUPS: readonly (readonly ProductCategoryType[])[] = [
  // 상황: 무슨 날, 누구에게
  [C.BIRTHDAY, C.COUPLE, C.THANKS, C.BABY, C.CONGRATS, C.WEDDING, C.SEASON],
  // 디자인: 어떻게 꾸몄나(하트·2단 같은 모양도 여기, 11-15 "모양" 묶음을 합침)
  [
    C.LETTERING,
    C.DRAWING,
    C.PHOTO,
    C.CHARACTER,
    C.FLOWER,
    C.RIBBON,
    C.FRUIT,
    C.HEART,
    C.TWO_TIER,
    C.SIMPLE,
  ],
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
 * 없앤 값(11-15 저녁 운영자: 빈티지·입체). 공유된 옛 주소·배포 사이 옛 화면이 보내면 조용히 뺀다
 * (DB 값은 migration 20261115180000에서 지웠다).
 */
export const REMOVED_PRODUCT_CATEGORIES: ReadonlySet<string> = new Set(["VINTAGE", "SCULPTED"]);

/**
 * 요청 값의 옛 카테고리를 새 값으로 바꾸고, 없앤 값은 빼고, 겹친 것을 지운다. 모르는 값은 그대로 두어 검사(IsEnum)가 막게 한다.
 */
export function normalizeProductCategoryTypes(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  // Set으로 겹친 것을 지운다(긴 배열이 와도 한 번만 훑는다). 처음 나온 순서는 지킨다
  const out = new Set<unknown>();
  for (const item of value) {
    if (typeof item === "string" && REMOVED_PRODUCT_CATEGORIES.has(item)) continue;
    const isLegacy =
      typeof item === "string" &&
      Object.prototype.hasOwnProperty.call(LEGACY_PRODUCT_CATEGORY_MAP, item);
    out.add(isLegacy ? LEGACY_PRODUCT_CATEGORY_MAP[item as string] : item);
  }
  return [...out];
}

/**
 * 요청 DTO의 카테고리 배열 변환: 하나만 오면(쿼리 ?productCategoryTypes=BIRTHDAY) 배열로, 옛 값은 새 값으로,
 * 없앤 값(빈티지·입체)은 뺀다. 빈 배열은 그대로 둔다(상품 수정에서 "전부 지우기").
 * 상품 등록·수정, 상품·스토어·좋아요·판매자 스토어 목록이 같이 쓴다.
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

/**
 * 당일픽업은 바로 예약해 오늘 가져가는 상품이라, 견적 받기 상품(사장님 답을 기다려야 함)은 사장님이 골라 두어도
 * **손님 목록**에서 당일픽업으로 거를 때 빼낸다(기획 I-01 2026-11-19). 사장님 자기 목록에서는 고른 분류 그대로 보인다
 * (`customerList: true`를 넘긴 곳만 뺀다)
 */
const isSameDayGroup = (group: readonly ProductCategoryType[]) => group.includes(C.SAME_DAY_PICKUP);

/** Prisma 상품 조건: 묶음마다 hasSome, 묶음끼리 AND */
export function productCategoryWhereConditions(
  types: readonly ProductCategoryType[] | undefined,
  options: { customerList?: boolean } = {},
): Prisma.ProductWhereInput[] {
  return groupProductCategoryTypes(types).map((group) => ({
    productCategoryTypes: { hasSome: group },
    ...(options.customerList && isSameDayGroup(group)
      ? { orderMethod: ProductOrderMethod.RESERVATION }
      : {}),
  }));
}

/** Raw SQL 상품 조건: 묶음마다 배열 겹침(&&), 묶음끼리 AND(조건 목록에 하나씩 넣는다) */
export function productCategorySqlConditions(
  types: readonly ProductCategoryType[] | undefined,
  tableAlias = "p",
  options: { customerList?: boolean } = {},
): Prisma.Sql[] {
  const column = Prisma.raw(`${tableAlias}.product_category_types`);
  const orderMethodColumn = Prisma.raw(`${tableAlias}.order_method`);
  return groupProductCategoryTypes(types).map((group) =>
    options.customerList && isSameDayGroup(group)
      ? Prisma.sql`(${column}::text[] && ARRAY[${Prisma.join(group)}]::text[] AND ${orderMethodColumn}::text = ${ProductOrderMethod.RESERVATION})`
      : Prisma.sql`${column}::text[] && ARRAY[${Prisma.join(group)}]::text[]`,
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
  [C.SIMPLE, ["심플"]],
  [C.HEART, ["하트"]],
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
