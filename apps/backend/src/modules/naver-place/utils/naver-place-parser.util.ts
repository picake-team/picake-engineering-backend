import {
  NAVER_PLACE_APOLLO_STATE_MARKER,
  NAVER_PLACE_MAX_PHOTOS,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";

type ApolloState = Record<string, any>;

/** 요일별 영업시간 */
export type NaverPlaceBusinessDay = {
  /** 네이버 요일 표기 (월, 화, …, 매일, 평일, 주말) */
  day: string;
  /** 영업 시작 HH:mm (휴무면 null) */
  open: string | null;
  /** 영업 종료 HH:mm (휴무면 null) */
  close: string | null;
  /** 종료 시각이 다음 날인지 */
  endsNextDay: boolean;
  breakHours: { start: string; end: string }[];
  lastOrder: string | null;
  /** 예: "정기휴무 (매주 화요일)" */
  description: string | null;
};

/** 네이버 플레이스 상세에서 꺼낸 매장 정보 */
export type NaverPlaceInfo = {
  placeId: string;
  placeUrl: string;
  name: string;
  category: string | null;
  roadAddress: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  isVirtualPhone: boolean;
  /** 찾아오는 길 */
  directions: string | null;
  description: string | null;
  keywords: string[];
  conveniences: string[];
  parking: string | null;
  paymentMethods: string[];
  businessHours: {
    /** 예: "영업 중", "오늘 휴무" (조회 시점 기준) */
    status: string | null;
    /** 예: "매주 화요일 휴무" */
    statusDescription: string | null;
    days: NaverPlaceBusinessDay[];
    /** 사장님이 적은 영업시간 안내 문구 */
    freeText: string | null;
  };
  links: {
    instagram: string | null;
    others: { type: string; url: string }[];
  };
  menus: {
    name: string;
    price: string | null;
    description: string | null;
    imageUrl: string | null;
    isRecommended: boolean;
  }[];
  menuImageUrls: string[];
  photos: {
    total: number;
    urls: string[];
  };
  reviews: {
    visitorCount: number;
    visitorRating: number | null;
    imageReviewCount: number;
    blogCafeCount: number;
    keywords: { label: string; count: number }[];
  };
  naverBookingUrl: string | null;
  /** 네이버가 붙이는 "미입력" 표시. 실제 값과 다를 때가 있어 참고용 */
  missingInfo: Record<string, boolean>;
};

/**
 * HTML에서 `window.__APOLLO_STATE__ = {...};` JSON을 꺼낸다.
 * 정규식으로 끝을 찾으면 문자열 안의 `};`에서 잘릴 수 있어 중괄호 짝을 직접 센다.
 */
export function extractApolloState(html: string): ApolloState | null {
  const markerIndex = html.indexOf(NAVER_PLACE_APOLLO_STATE_MARKER);
  if (markerIndex < 0) return null;
  const start = html.indexOf("{", markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Apollo 캐시의 `{ __ref: "Type:id" }` 참조를 실제 객체로 바꾼다 */
function deref(state: ApolloState, value: any): any {
  if (value && typeof value === "object" && typeof value.__ref === "string") {
    return state[value.__ref] ?? null;
  }
  return value ?? null;
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) ? n : null;
};

const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((v): v is string => v !== null) : [];

/**
 * Apollo 상태에서 네이버 플레이스 정보를 꺼낸다. 상세 데이터가 없으면 null.
 */
export function parseNaverPlace(state: ApolloState, placeId: string): NaverPlaceInfo | null {
  const rootQuery = state.ROOT_QUERY ?? {};
  const detailKey = Object.keys(rootQuery).find(
    (key) => key.startsWith("placeDetail(") && key.includes(`"id":"${placeId}"`),
  );
  const detail = detailKey ? deref(state, rootQuery[detailKey]) : null;
  const base = detail ? deref(state, detail.base) : null;
  if (!detail || !base || !str(base.name)) return null;

  const phoneInfo = detail.phoneInfo ?? {};
  const phone = str(phoneInfo.phone) ?? str(base.phone) ?? str(base.virtualPhone);

  const hoursEntry = Array.isArray(detail.newBusinessHours) ? detail.newBusinessHours[0] : null;
  const days: NaverPlaceBusinessDay[] = (hoursEntry?.businessHours ?? []).map((d: any) => ({
    day: str(d?.day) ?? "",
    open: str(d?.businessHours?.start),
    close: str(d?.businessHours?.end),
    endsNextDay: d?.showEndsNextDay === true,
    breakHours: (Array.isArray(d?.breakHours) ? d.breakHours : [])
      .map((b: any) => ({ start: str(b?.start), end: str(b?.end) }))
      .filter((b: any) => b.start && b.end),
    lastOrder: Array.isArray(d?.lastOrderTimes) ? str(d.lastOrderTimes[0]?.time) : null,
    description: str(d?.description),
  }));

  const homepages = detail.homepages ?? {};
  const allLinks = [homepages.repr, ...(Array.isArray(homepages.etc) ? homepages.etc : [])]
    .filter(Boolean)
    .map((h: any) => ({ type: str(h.type) ?? "", url: str(h.landingUrl) ?? str(h.url) ?? "" }))
    .filter((h) => h.url);
  const instagram =
    allLinks.find((h) => h.type === "인스타그램" || /instagram\.com/i.test(h.url))?.url ?? null;

  const placeMenus = detail.placeMenus ?? {};
  const recommendedIds = new Set<string>(
    (placeMenus.categories ?? [])
      .map((c: any) => deref(state, c))
      .filter((c: any) => c?.kind === "recommend")
      .flatMap((c: any) => c.itemIds ?? []),
  );
  const menus = (placeMenus.items ?? [])
    .map((m: any) => deref(state, m))
    .filter((m: any) => str(m?.name))
    .map((m: any) => ({
      name: str(m.name) as string,
      price: str(m.price?.displayText) ?? str(m.price?.price),
      description: str(m.description),
      imageUrl: str(m.thumbnailUrl) ?? str(m.images?.[0]?.url) ?? str(m.images?.[0]),
      isRecommended: recommendedIds.has(m.id),
    }));

  const topPhotos = detail.topPhotos ?? {};
  const photoUrls = (topPhotos.items ?? [])
    .map((p: any) => deref(state, p))
    .filter((p: any) => p?.mediaFormat !== "video")
    .map((p: any) => str(p?.originalUrl) ?? str(p?.thumbnailUrl))
    .filter((u: string | null): u is string => u !== null);
  if (!photoUrls.length) {
    photoUrls.push(
      ...(detail.images?.images ?? []).map((i: any) => str(i?.origin)).filter(Boolean),
    );
  }

  const reviewStats = deref(state, detail.visitorReviewStats) ?? {};
  const voted = reviewStats.analysis?.votedKeyword?.details ?? [];

  const info = detail.informationTab ?? {};
  const coordinate = base.coordinate ?? {};

  return {
    placeId,
    placeUrl: `https://map.naver.com/p/entry/place/${placeId}`,
    name: str(base.name) as string,
    category: str(base.category),
    roadAddress: str(base.roadAddress),
    address: str(base.address),
    latitude: num(coordinate.y),
    longitude: num(coordinate.x),
    phone,
    isVirtualPhone: phoneInfo.isVirtualPhone === true || (!!phone && phone.startsWith("0507")),
    directions: str(base.road),
    description: str(detail.description),
    keywords: strList(info.keywordList),
    conveniences: strList(base.conveniences),
    parking: str(info.parkingInfo?.description),
    paymentMethods: strList(base.paymentInfo),
    businessHours: {
      status: str(hoursEntry?.businessStatusDescription?.status),
      statusDescription: str(hoursEntry?.businessStatusDescription?.description),
      days,
      freeText: str(hoursEntry?.freeText),
    },
    links: {
      instagram,
      others: allLinks.filter((h) => h.url !== instagram),
    },
    menus,
    menuImageUrls: strList((detail.menuImages ?? []).map((m: any) => m?.imageUrl)),
    photos: {
      total: num(topPhotos.total) ?? photoUrls.length,
      urls: photoUrls.slice(0, NAVER_PLACE_MAX_PHOTOS),
    },
    reviews: {
      visitorCount: num(reviewStats.review?.totalCount) ?? num(base.visitorReviewsTotal) ?? 0,
      visitorRating: num(reviewStats.review?.avgRating) ?? num(base.visitorReviewsScore),
      imageReviewCount: num(reviewStats.review?.imageReviewCount) ?? 0,
      blogCafeCount: num(base.cafeBlogReviewsTotal) ?? 0,
      keywords: voted
        .filter((k: any) => str(k?.displayName))
        .map((k: any) => ({ label: str(k.displayName) as string, count: num(k.count) ?? 0 })),
    },
    naverBookingUrl: str(detail.naverBooking?.naverBookingUrl),
    missingInfo: Object.fromEntries(
      Object.entries(base.missingInfo ?? {}).filter(([, v]) => typeof v === "boolean"),
    ) as Record<string, boolean>,
  };
}
