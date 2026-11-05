import {
  CakeSizeDisplayName,
  CUSTOM_OPTION_LIMITS,
} from "@apps/backend/modules/product/constants/product.constants";
import { NAVER_PRODUCT_WARNINGS } from "@apps/backend/modules/naver-place/constants/naver-booking.constants";
import type {
  NaverBookingItem,
  NaverBookingOption,
  NaverBookingOptionsResult,
} from "@apps/backend/modules/naver-place/utils/naver-booking-parser.util";

/**
 * 네이버 옵션을 Picake에서 어떻게 쓸지에 대한 제안
 * SIZE 사이즈 / EXTRA 추가 옵션 선택지(맛도 여기, 그룹 이름 "맛") / BASE 이 상품의 기본 가격(판매가)
 */
export type NaverOptionRole = "SIZE" | "EXTRA" | "BASE";

export type NaverProductOptionSuggestion = {
  optionId: string;
  categoryName: string | null;
  name: string;
  desc: string | null;
  /** 네이버 옵션 가격 (원) */
  price: number | null;
  isSoldOut: boolean;
  /** 옵션 사진 (있으면 옵션을 상품으로 가져올 때 씀) */
  imageUrl: string | null;
  /** 제안 용도. 판매자가 바꿀 수 있다 */
  role: NaverOptionRole;
  /** 사이즈로 볼 때의 표시명 (도시락·미니·1~3호가 하나만 있을 때만) */
  sizeDisplayName: CakeSizeDisplayName | null;
  /** 옵션 이름·설명에 지름(cm)이 적혀 있을 때만 채운다. 호수로 추정하지 않는다 */
  lengthCm: number | null;
  /** 가져오기 화면에서 처음부터 고를지 */
  selectedByDefault: boolean;
  /** 그대로 넣을 수 없는 이유 */
  invalidReason: string | null;
  /** 추가 옵션으로 넣을 때의 그룹 이름 (네이버 분류 이름, 없으면 '추가 선택') */
  groupName: string;
  /** 네이버에서 필수로 고르게 한 분류인지 (예: "포장 리본(필수선택)") */
  groupRequired: boolean;
};

export type NaverProductSuggestion = {
  name: string;
  description: string | null;
  precautions: string | null;
  imageUrls: string[];
  options: NaverProductOptionSuggestion[];
  /** 사이즈 옵션 중 가장 싼 가격. 판매가 후보 */
  suggestedSalePrice: number | null;
  isClosed: boolean;
  soldOutOptionNames: string[];
  /** 여러 상품을 옵션으로 묶은 네이버 상품(포장주문 등)으로 보이는지. 옵션을 상품 하나씩 가져오도록 안내 */
  menuLike: boolean;
  warnings: string[];
};

const SIZE_PATTERNS: { pattern: RegExp; displayName: CakeSizeDisplayName }[] = [
  { pattern: /도시락/, displayName: CakeSizeDisplayName.DOSIRAK },
  { pattern: /미니/, displayName: CakeSizeDisplayName.MINI },
  { pattern: /(^|[^0-9])1\s*호/, displayName: CakeSizeDisplayName.SIZE_1 },
  { pattern: /(^|[^0-9])2\s*호/, displayName: CakeSizeDisplayName.SIZE_2 },
  { pattern: /(^|[^0-9])3\s*호/, displayName: CakeSizeDisplayName.SIZE_3 },
];

/**
 * 분류 이름으로 사이즈·맛 분류를 알아본다 (예: "케이크 사이즈 선택", "케이크 맛 선택", "맛").
 * 맛은 따로 두지 않고 "맛"이라는 추가 옵션(하나 고르기, 필수)으로 넣는다.
 */
const SIZE_CATEGORY = /사이즈|크기|호수|size/i;
const FLAVOR_CATEGORY = /맛(?!있)|flavou?r/i;

/** 옵션이 따로 팔리는 케이크처럼 보이는 가격 (원) */
const MENU_LIKE_MIN_PRICE = 10_000;
/** 커피·조각 케이크처럼 따로 팔리는 상품으로 볼 수 있는 가격 (원) */
const MENU_ITEM_MIN_PRICE = 5_000;
/** 이름으로 알 수 있는 묶음 주문서 (예: 포장주문, 테이블주문) */
const MENU_LIKE_NAME = /(포장|테이블|매장|픽업)\s*주문|주문서|메뉴판|전체\s*메뉴/;
/** 상품이 아닌 결제 항목 (계약금, 개인결제창) */
const PAYMENT_OPTION_NAME = /계약금|결제\s*창|개인\s*결제|선결제/;

/** 추가 옵션 그룹 기본 이름 */
export const NAVER_EXTRA_GROUP_NAME = "추가 선택";
/** 맛 분류를 넣을 추가 옵션 이름 */
export const NAVER_FLAVOR_GROUP_NAME = "맛";
const REQUIRED_CATEGORY = /필수/;
const GROUP_NAME_MAX = CUSTOM_OPTION_LIMITS.MAX_NAME_LENGTH;

/** 분류 이름을 추가 옵션 그룹 이름으로: "(필수선택)" 같은 표시는 빼고 20자까지 */
function toGroupName(categoryName: string | null): string {
  const cleaned = (categoryName ?? "").replace(/\(?\s*필수\s*선택\s*\)?/g, "").trim();
  if (!cleaned || /^사이즈$/.test(cleaned)) return NAVER_EXTRA_GROUP_NAME;
  // "케이크 맛 선택"처럼 맛 분류는 손님이 알아보기 쉽게 "맛"으로 줄인다
  if (FLAVOR_CATEGORY.test(cleaned)) return NAVER_FLAVOR_GROUP_NAME;
  return cleaned.slice(0, GROUP_NAME_MAX);
}

/** 옵션 이름에서 Picake 사이즈 표시명을 찾는다 (여러 개면 판단하지 않음) */
export function detectSizeDisplayName(name: string): CakeSizeDisplayName | null {
  const found = SIZE_PATTERNS.filter((p) => p.pattern.test(name));
  return found.length === 1 ? found[0].displayName : null;
}

/**
 * 글에 적힌 지름(cm)을 찾는다. "지름/직경 15cm"를 먼저 보고, 없으면 cm 숫자가 하나뿐일 때만 쓴다.
 */
export function detectLengthCm(...texts: (string | null)[]): number | null {
  const text = texts.filter(Boolean).join("\n");
  if (!text) return null;
  const labeled = text.match(/(?:지름|직경)\s*[:：]?\s*(\d{1,2}(?:\.\d)?)\s*(?:cm|센치|센티)/i);
  if (labeled) return Number(labeled[1]);
  const all = [...text.matchAll(/(\d{1,2}(?:\.\d)?)\s*(?:cm|센치|센티)/gi)].map((m) =>
    Number(m[1]),
  );
  const unique = [...new Set(all)];
  return unique.length === 1 ? unique[0] : null;
}

/** 옵션 하나의 용도를 정한다: 분류 이름 → 옵션 이름 순서로 본다 */
function decideRole(o: NaverBookingOption): {
  role: NaverOptionRole;
  sizeDisplayName: CakeSizeDisplayName | null;
} {
  const sizeDisplayName = detectSizeDisplayName(o.name);
  if (o.categoryName && SIZE_CATEGORY.test(o.categoryName))
    return { role: "SIZE", sizeDisplayName };
  if (o.categoryName && FLAVOR_CATEGORY.test(o.categoryName)) {
    return { role: "EXTRA", sizeDisplayName: null };
  }
  return sizeDisplayName ? { role: "SIZE", sizeDisplayName } : { role: "EXTRA", sizeDisplayName };
}

const precautionsText = (item: NaverBookingItem) =>
  item.precautions.length > 0
    ? item.precautions.map((p) => (p.title ? `${p.title}\n${p.desc}` : p.desc)).join("\n\n")
    : null;

/**
 * 네이버 예약 상품·옵션을 Picake 상품 등록 화면에 채울 제안값으로 바꾼다.
 * 옵션 용도·가격 의미가 분명하지 않으면 처음부터 고르지 않고 경고를 남긴다.
 * status: 옵션을 읽은 결과 (OK / NO_SCHEDULE 예약 가능한 날 없음 / FAILED 옵션을 읽을 수 없는 방식)
 */
export function toNaverProductSuggestion(
  item: NaverBookingItem,
  options: NaverBookingOption[] | null,
  status: NaverBookingOptionsResult["status"] = options ? "OK" : "NO_SCHEDULE",
): NaverProductSuggestion {
  const warnings: string[] = [];
  const itemPrice = item.price && item.price > 0 ? item.price : null;

  const suggestions: NaverProductOptionSuggestion[] = (options ?? []).map((o) => {
    const { role, sizeDisplayName } = decideRole(o);
    let invalidReason: string | null = null;
    if (o.price === null) invalidReason = NAVER_PRODUCT_WARNINGS.OPTION_NO_PRICE;
    else if (PAYMENT_OPTION_NAME.test(o.name))
      invalidReason = NAVER_PRODUCT_WARNINGS.PAYMENT_OPTION;
    else if (role === "SIZE" && !sizeDisplayName) {
      invalidReason = "사이즈(도시락·미니·1~3호)를 골라 주세요.";
    } else if (role !== "SIZE" && o.name.length > CUSTOM_OPTION_LIMITS.MAX_CHOICE_LABEL_LENGTH) {
      invalidReason = `선택지 이름은 ${CUSTOM_OPTION_LIMITS.MAX_CHOICE_LABEL_LENGTH}자까지예요(지금 ${o.name.length}자).`;
    }
    return {
      optionId: o.optionId,
      categoryName: o.categoryName,
      name: o.name,
      desc: o.desc,
      price: o.price,
      isSoldOut: o.isSoldOut,
      imageUrl: o.imageUrl,
      role,
      sizeDisplayName,
      lengthCm: role === "SIZE" ? detectLengthCm(o.name, o.desc) : null,
      selectedByDefault: !invalidReason,
      invalidReason,
      groupName: toGroupName(o.categoryName),
      // 맛은 손님이 하나를 꼭 고르게 한다
      groupRequired:
        !!o.categoryName &&
        (REQUIRED_CATEGORY.test(o.categoryName) || FLAVOR_CATEGORY.test(o.categoryName)),
    };
  });

  const sizes = suggestions.filter((s) => s.role === "SIZE");

  // 같은 사이즈가 여러 개면 첫 번째만 고른다 (맛이 섞인 옵션일 수 있음)
  const seenSize = new Set<CakeSizeDisplayName>();
  for (const s of sizes) {
    if (!s.sizeDisplayName) continue;
    if (seenSize.has(s.sizeDisplayName)) {
      s.selectedByDefault = false;
      s.invalidReason = `'${s.sizeDisplayName}' 사이즈가 이미 있어요. 맛이 다른 옵션이면 추가 옵션으로 넣어 주세요.`;
    }
    seenSize.add(s.sizeDisplayName);
  }

  // 상품 가격과 옵션 가격이 둘 다 있으면 옵션 가격이 최종가인지 추가금인지 알 수 없다
  if (itemPrice && sizes.some((s) => (s.price ?? 0) > 0)) {
    warnings.push(NAVER_PRODUCT_WARNINGS.PRICE_AMBIGUOUS);
    for (const s of sizes) s.selectedByDefault = false;
  }

  // 사이즈 없이 상품처럼 팔리는 옵션이 여러 개면 "여러 상품을 묶은 주문서"로 본다 (예: 포장주문)
  const extrasOnly = suggestions.filter(
    (s) => s.role === "EXTRA" && !PAYMENT_OPTION_NAME.test(s.name),
  );
  const countAtLeast = (min: number) => extrasOnly.filter((s) => (s.price ?? 0) >= min).length;
  const menuLike =
    sizes.length === 0 &&
    suggestions.length > 0 &&
    (MENU_LIKE_NAME.test(item.name) ||
      countAtLeast(MENU_LIKE_MIN_PRICE) >= 2 ||
      countAtLeast(MENU_ITEM_MIN_PRICE) >= 3);

  // 사이즈 없이 비싼 옵션이 하나뿐이고 다른 옵션보다 2배 이상 비싸면 그 옵션이 이 상품의 기본 가격이다
  // (예: "빼낭시에 6구 29,000원" + 초 추가 500원). 추가 옵션으로 넣으면 판매가에 또 더해지므로 판매가로 쓴다
  const baseCandidates = extrasOnly.filter((s) => (s.price ?? 0) >= MENU_LIKE_MIN_PRICE);
  const otherMax = Math.max(
    0,
    ...extrasOnly.filter((s) => s !== baseCandidates[0]).map((s) => s.price ?? 0),
  );
  const base =
    sizes.length === 0 &&
    !menuLike &&
    !itemPrice &&
    baseCandidates.length === 1 &&
    (baseCandidates[0].price ?? 0) >= otherMax * 2
      ? baseCandidates[0]
      : null;
  if (base) {
    base.role = "BASE";
    // 기본 가격 옵션과 같은 분류의 다른 옵션은 '추가 선택' 그룹으로 (분류 이름이 상품 종류일 때가 많음)
    for (const s of suggestions) {
      if (s !== base && s.categoryName && s.categoryName === base.categoryName) {
        s.groupName = NAVER_EXTRA_GROUP_NAME;
      }
    }
  }
  if (menuLike) {
    warnings.push(NAVER_PRODUCT_WARNINGS.MENU_LIKE);
    // 묶음 주문서의 옵션을 한 상품의 추가 옵션으로 넣으면 맞지 않으므로 처음엔 고르지 않는다
    for (const s of suggestions) s.selectedByDefault = false;
  }

  if (status === "FAILED") warnings.push(NAVER_PRODUCT_WARNINGS.OPTIONS_FAILED);
  else if (status === "NO_SCHEDULE") warnings.push(NAVER_PRODUCT_WARNINGS.OPTIONS_UNAVAILABLE);
  else if (suggestions.length === 0) warnings.push(NAVER_PRODUCT_WARNINGS.NO_OPTIONS);
  else if (sizes.length === 0 && !menuLike) warnings.push(NAVER_PRODUCT_WARNINGS.NO_SIZE_OPTION);

  for (const s of sizes) {
    if (s.selectedByDefault && s.lengthCm === null) {
      warnings.push(NAVER_PRODUCT_WARNINGS.LENGTH_UNKNOWN(s.name));
    }
  }

  const extras = suggestions.filter((s) => s.role === "EXTRA" && s.selectedByDefault);
  if (extras.length > CUSTOM_OPTION_LIMITS.MAX_CHOICES) {
    warnings.push(NAVER_PRODUCT_WARNINGS.TOO_MANY_EXTRAS(CUSTOM_OPTION_LIMITS.MAX_CHOICES));
    extras.slice(CUSTOM_OPTION_LIMITS.MAX_CHOICES).forEach((e) => (e.selectedByDefault = false));
  }

  const soldOutOptionNames = suggestions.filter((s) => s.isSoldOut).map((s) => s.name);
  if (soldOutOptionNames.length > 0) {
    warnings.push(NAVER_PRODUCT_WARNINGS.SOLD_OUT(soldOutOptionNames.join(", ")));
  }
  if (item.isClosed) warnings.push(NAVER_PRODUCT_WARNINGS.ITEM_CLOSED);
  if (item.subType === "RESTAURANT_VISIT") warnings.push(NAVER_PRODUCT_WARNINGS.VISIT_ITEM);

  const sizePrices = sizes
    .filter((s) => s.selectedByDefault && (s.price ?? 0) > 0)
    .map((s) => s.price as number);
  const suggestedSalePrice =
    sizePrices.length > 0 ? Math.min(...sizePrices) : (base?.price ?? itemPrice);

  return {
    name: item.name,
    description: item.desc,
    precautions: precautionsText(item),
    imageUrls: item.imageUrls,
    options: suggestions,
    suggestedSalePrice,
    isClosed: item.isClosed,
    soldOutOptionNames,
    menuLike,
    warnings,
  };
}

/**
 * 네이버 상품 안의 옵션 하나를 Picake 상품 하나로 가져올 때의 제안값 (포장주문처럼 여러 상품을 묶은 경우).
 * 이름·설명·가격·사진은 옵션에서, 주의사항은 네이버 상품에서 가져온다.
 */
export function toNaverOptionProductSuggestion(
  item: NaverBookingItem,
  option: NaverBookingOption,
): NaverProductSuggestion {
  const warnings = [NAVER_PRODUCT_WARNINGS.OPTION_AS_PRODUCT(item.name)];
  if (option.isSoldOut) warnings.push(NAVER_PRODUCT_WARNINGS.SOLD_OUT(option.name));
  if (item.isClosed) warnings.push(NAVER_PRODUCT_WARNINGS.ITEM_CLOSED);

  const sizeDisplayName = detectSizeDisplayName(option.name);
  return {
    name: option.name,
    description: option.desc,
    precautions: precautionsText(item),
    imageUrls: option.imageUrl ? [option.imageUrl] : item.imageUrls,
    options: [],
    suggestedSalePrice: option.price && option.price > 0 ? option.price : null,
    isClosed: item.isClosed,
    soldOutOptionNames: option.isSoldOut ? [option.name] : [],
    menuLike: false,
    warnings: sizeDisplayName
      ? warnings
      : [...warnings.slice(0, 1), NAVER_PRODUCT_WARNINGS.NO_SIZE_OPTION, ...warnings.slice(1)],
  };
}
