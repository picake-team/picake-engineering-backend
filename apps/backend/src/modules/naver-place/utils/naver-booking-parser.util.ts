import {
  NAVER_BOOKING_ID_REGEX,
  NAVER_BOOKING_MAX_IMAGES,
  NAVER_IMAGE_HOST_SUFFIX,
} from "@apps/backend/modules/naver-place/constants/naver-booking.constants";

/** 네이버 예약 상품 1개 (화면에 필요한 값만) */
export type NaverBookingItem = {
  bizItemId: string;
  name: string;
  desc: string | null;
  /** 상품 가격. 픽업 상품은 보통 0이고 실제 가격은 옵션에 있다 */
  price: number | null;
  subType: string | null;
  requiresOption: boolean;
  isClosed: boolean;
  precautions: { title: string | null; desc: string }[];
  imageUrls: string[];
};

/** 네이버 예약 옵션 1개 */
export type NaverBookingOption = {
  optionId: string;
  categoryName: string | null;
  name: string;
  desc: string | null;
  price: number | null;
  normalPrice: number | null;
  isSoldOut: boolean;
  remainStock: number | null;
};

/** 옵션을 읽을 때 쓰는 예약 시간 */
export type NaverBookingSlot = { slotId: string; scheduleId: string; startDate: string };

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const id = (v: unknown): string | null => {
  const s = typeof v === "number" ? String(v) : str(v);
  return s && NAVER_BOOKING_ID_REGEX.test(s) ? s : null;
};

/**
 * 네이버 이미지 서버(https, *.pstatic.net) 주소만 남긴다.
 * 판매자가 고른 사진을 서버가 받을 때 다른 곳으로 요청하지 않게 하는 기준이다.
 */
export function toNaverImageUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.endsWith(NAVER_IMAGE_HOST_SUFFIX)) return null;
    if (url.username || url.password || url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * `bizItems` 응답에서 상품 목록을 꺼낸다. 형식이 맞지 않는 항목은 버린다.
 */
export function parseNaverBookingItems(data: unknown): NaverBookingItem[] {
  const list = (data as any)?.data?.bizItems;
  if (!Array.isArray(list)) return [];

  const items: NaverBookingItem[] = [];
  for (const raw of list) {
    const bizItemId = id(raw?.bizItemId);
    const name = str(raw?.name);
    if (!bizItemId || !name) continue;
    // 노출하지 않는 상품(isImp=false)은 손님에게도 안 보이므로 뺀다
    if (raw?.isImp === false) continue;

    const resources = Array.isArray(raw?.bizItemResources) ? [...raw.bizItemResources] : [];
    resources.sort((a: any, b: any) => (num(a?.order) ?? 0) - (num(b?.order) ?? 0));
    const imageUrls = resources
      .map((r: any) => toNaverImageUrl(r?.resourceUrl))
      .filter((u): u is string => !!u)
      .slice(0, NAVER_BOOKING_MAX_IMAGES);

    const precautions = (Array.isArray(raw?.bookingPrecautionJson) ? raw.bookingPrecautionJson : [])
      .map((p: any) => ({ title: str(p?.title), desc: str(p?.desc) }))
      .filter(
        (p: { desc: string | null }): p is { title: string | null; desc: string } => !!p.desc,
      );

    items.push({
      bizItemId,
      name,
      desc: str(raw?.desc),
      price: num(raw?.price),
      subType: str(raw?.bizItemSubType),
      requiresOption: raw?.isRequiringBookingOption === true,
      isClosed: raw?.isClosedBooking === true,
      precautions,
      imageUrls,
    });
  }
  return items;
}

/**
 * `hourlySchedule` 응답에서 옵션을 읽을 예약 시간 하나를 고른다(영업·판매하는 가장 이른 시간).
 * 옵션은 예약 시간마다 같다고 보고 하나만 읽는다.
 */
export function pickNaverBookingSlot(data: unknown): NaverBookingSlot | null {
  const list = (data as any)?.data?.hourlySchedule;
  if (!Array.isArray(list)) return null;

  for (const s of list) {
    const open =
      s?.isBusinessDay !== false &&
      s?.isSaleDay !== false &&
      s?.isUnitBusinessDay !== false &&
      s?.isUnitSaleDay !== false;
    const slotId = id(s?.slotId);
    const scheduleId = id(s?.scheduleId);
    const startDate = str(s?.unitStartDateTime)?.slice(0, 10) ?? null;
    if (open && slotId && scheduleId && startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return { slotId, scheduleId, startDate };
    }
  }
  return null;
}

/**
 * `option` 응답을 한 줄 목록으로 편다. 하위 분류(children)의 옵션도 분류 이름과 함께 넣는다.
 */
export function parseNaverBookingOptions(data: unknown): NaverBookingOption[] {
  const categories = (data as any)?.data?.option;
  if (!Array.isArray(categories)) return [];

  const out: NaverBookingOption[] = [];
  const seen = new Set<string>();
  const push = (raw: any, categoryName: string | null) => {
    const optionId = id(raw?.optionId);
    const name = str(raw?.name);
    if (!optionId || !name || seen.has(optionId)) return;
    seen.add(optionId);
    out.push({
      optionId,
      categoryName,
      name,
      desc: str(raw?.desc),
      price: num(raw?.price),
      normalPrice: num(raw?.normalPrice),
      isSoldOut: raw?.isSoldOut === true || raw?.isTodaySoldOut === true,
      remainStock: num(raw?.remainStock),
    });
  };

  for (const c of categories) {
    // "카테고리 미지정"은 판매자가 분류를 만들지 않은 것이므로 이름으로 쓰지 않는다
    const name = str(c?.name);
    const categoryName = name && name !== "카테고리 미지정" ? name : null;
    for (const o of Array.isArray(c?.options) ? c.options : []) push(o, categoryName);
    for (const child of Array.isArray(c?.children) ? c.children : []) {
      const childName = str(child?.name) ?? categoryName;
      for (const o of Array.isArray(child?.options) ? child.options : []) push(o, childName);
    }
  }
  return out;
}
