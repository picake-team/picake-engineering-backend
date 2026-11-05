import {
  CakeSizeDisplayName,
  CUSTOM_OPTION_LIMITS,
} from "@apps/backend/modules/product/constants/product.constants";
import { NAVER_PRODUCT_WARNINGS } from "@apps/backend/modules/naver-place/constants/naver-booking.constants";
import type {
  NaverBookingItem,
  NaverBookingOption,
} from "@apps/backend/modules/naver-place/utils/naver-booking-parser.util";

/** 네이버 옵션을 Picake에서 어떻게 쓸지에 대한 제안 */
export type NaverOptionRole = "SIZE" | "EXTRA";

export type NaverProductOptionSuggestion = {
  optionId: string;
  categoryName: string | null;
  name: string;
  desc: string | null;
  /** 네이버 옵션 가격 (원) */
  price: number | null;
  isSoldOut: boolean;
  /** 제안 용도. 판매자가 바꿀 수 있다 */
  role: NaverOptionRole;
  /** 사이즈로 볼 때의 표시명 (옵션 이름에 도시락·미니·1~3호가 있을 때만) */
  sizeDisplayName: CakeSizeDisplayName | null;
  /** 옵션 이름·설명에 지름(cm)이 적혀 있을 때만 채운다. 호수로 추정하지 않는다 */
  lengthCm: number | null;
  /** 가져오기 화면에서 처음부터 고를지 */
  selectedByDefault: boolean;
  /** 그대로 넣을 수 없는 이유 (예: 추가 옵션 선택지 글자 수 초과) */
  invalidReason: string | null;
};

export type NaverProductSuggestion = {
  name: string;
  /** 네이버 상품 설명 (원문) */
  description: string | null;
  /** 네이버 예약 주의사항 (원문) */
  precautions: string | null;
  imageUrls: string[];
  options: NaverProductOptionSuggestion[];
  /** 사이즈 옵션 중 가장 싼 가격. 판매가 후보 */
  suggestedSalePrice: number | null;
  isClosed: boolean;
  soldOutOptionNames: string[];
  warnings: string[];
};

const SIZE_PATTERNS: { pattern: RegExp; displayName: CakeSizeDisplayName }[] = [
  { pattern: /도시락/, displayName: CakeSizeDisplayName.DOSIRAK },
  { pattern: /미니/, displayName: CakeSizeDisplayName.MINI },
  { pattern: /(^|[^0-9])1\s*호/, displayName: CakeSizeDisplayName.SIZE_1 },
  { pattern: /(^|[^0-9])2\s*호/, displayName: CakeSizeDisplayName.SIZE_2 },
  { pattern: /(^|[^0-9])3\s*호/, displayName: CakeSizeDisplayName.SIZE_3 },
];

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

/**
 * 네이버 예약 상품·옵션을 Picake 상품 등록 화면에 채울 제안값으로 바꾼다.
 * 옵션 용도·가격 의미가 분명하지 않으면 처음부터 고르지 않고 경고를 남긴다.
 */
export function toNaverProductSuggestion(
  item: NaverBookingItem,
  options: NaverBookingOption[] | null,
): NaverProductSuggestion {
  const warnings: string[] = [];
  const itemPrice = item.price && item.price > 0 ? item.price : null;

  const suggestions: NaverProductOptionSuggestion[] = (options ?? []).map((o) => {
    const sizeDisplayName = detectSizeDisplayName(o.name);
    const role: NaverOptionRole = sizeDisplayName ? "SIZE" : "EXTRA";
    const tooLong =
      role === "EXTRA" && o.name.length > CUSTOM_OPTION_LIMITS.MAX_CHOICE_LABEL_LENGTH
        ? `선택지 이름은 ${CUSTOM_OPTION_LIMITS.MAX_CHOICE_LABEL_LENGTH}자까지예요(지금 ${o.name.length}자).`
        : null;
    return {
      optionId: o.optionId,
      categoryName: o.categoryName,
      name: o.name,
      desc: o.desc,
      price: o.price,
      isSoldOut: o.isSoldOut,
      role,
      sizeDisplayName,
      lengthCm: sizeDisplayName ? detectLengthCm(o.name, o.desc) : null,
      selectedByDefault: !tooLong,
      invalidReason: tooLong,
    };
  });

  const sizes = suggestions.filter((s) => s.role === "SIZE");

  // 같은 사이즈가 여러 개면 첫 번째만 고른다 (맛이 섞인 옵션일 수 있음)
  const seenSize = new Set<CakeSizeDisplayName>();
  for (const s of sizes) {
    if (!s.sizeDisplayName) continue;
    if (seenSize.has(s.sizeDisplayName)) {
      s.selectedByDefault = false;
      s.invalidReason = `'${s.sizeDisplayName}' 사이즈가 이미 있어요. 맛이 다른 옵션이면 맛으로 따로 넣어 주세요.`;
    }
    seenSize.add(s.sizeDisplayName);
  }

  // 상품 가격과 옵션 가격이 둘 다 있으면 옵션 가격이 최종가인지 추가금인지 알 수 없다
  if (itemPrice && sizes.some((s) => (s.price ?? 0) > 0)) {
    warnings.push(NAVER_PRODUCT_WARNINGS.PRICE_AMBIGUOUS);
    for (const s of sizes) s.selectedByDefault = false;
  }

  if (options === null) warnings.push(NAVER_PRODUCT_WARNINGS.OPTIONS_UNAVAILABLE);
  else if (options.length === 0) warnings.push(NAVER_PRODUCT_WARNINGS.NO_OPTIONS);
  else if (sizes.length === 0) warnings.push(NAVER_PRODUCT_WARNINGS.NO_SIZE_OPTION);

  for (const s of sizes) {
    if (s.selectedByDefault && s.lengthCm === null) {
      warnings.push(NAVER_PRODUCT_WARNINGS.LENGTH_UNKNOWN(s.name));
    }
  }

  const extras = suggestions.filter((s) => s.role === "EXTRA");
  if (extras.length > CUSTOM_OPTION_LIMITS.MAX_CHOICES) {
    warnings.push(NAVER_PRODUCT_WARNINGS.TOO_MANY_EXTRAS(CUSTOM_OPTION_LIMITS.MAX_CHOICES));
    extras.slice(CUSTOM_OPTION_LIMITS.MAX_CHOICES).forEach((e) => (e.selectedByDefault = false));
  }

  warnings.push(NAVER_PRODUCT_WARNINGS.FLAVOR_REQUIRED);

  const soldOutOptionNames = suggestions.filter((s) => s.isSoldOut).map((s) => s.name);
  if (soldOutOptionNames.length > 0) {
    warnings.push(NAVER_PRODUCT_WARNINGS.SOLD_OUT(soldOutOptionNames.join(", ")));
  }
  if (item.isClosed) warnings.push(NAVER_PRODUCT_WARNINGS.ITEM_CLOSED);

  const sizePrices = sizes
    .filter((s) => s.selectedByDefault && (s.price ?? 0) > 0)
    .map((s) => s.price as number);
  const suggestedSalePrice = sizePrices.length > 0 ? Math.min(...sizePrices) : itemPrice;

  return {
    name: item.name,
    description: item.desc,
    precautions:
      item.precautions.length > 0
        ? item.precautions.map((p) => (p.title ? `${p.title}\n${p.desc}` : p.desc)).join("\n\n")
        : null,
    imageUrls: item.imageUrls,
    options: suggestions,
    suggestedSalePrice,
    isClosed: item.isClosed,
    soldOutOptionNames,
    warnings,
  };
}
