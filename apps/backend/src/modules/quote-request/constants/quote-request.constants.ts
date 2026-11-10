import {
  QuoteCakeSize,
  QuoteCream,
  QuoteRequestEntry,
} from "@apps/backend/infra/database/prisma/generated/client";

/**
 * 견적 요청(기획 I-46) 규칙. 숫자는 기획서 "요청서" 표와 같다.
 */
export const QUOTE_REQUEST_LIMITS = {
  /** 지금부터 이 시간 안의 시각은 픽업 시각이 될 수 없다(견적을 적어도 2시간 받게) */
  MIN_LEAD_HOURS: 3,
  /** 견적 마감 = 픽업 시작 1시간 전 */
  DEADLINE_BEFORE_PICKUP_HOURS: 1,
  /** 픽업 날짜를 너무 먼 날로 잡는 실수를 막는다 */
  MAX_DAYS_AHEAD: 365,
  MAX_PHOTOS: 3,
  DESCRIPTION_MAX_LENGTH: 500,
  REQUEST_NOTE_MAX_LENGTH: 200,
  FLAVOR_NOTE_MAX_LENGTH: 30,
  MAX_STORES: 5,
  MIN_QUANTITY: 1,
  MAX_QUANTITY: 50,
  /** 예산 막대: 1만원 ~ 10만원+, 1만원 단위 */
  BUDGET_STEP: 10_000,
  BUDGET_MIN: 10_000,
  BUDGET_MAX: 100_000,
  /** 한 손님이 동시에 열어 둘 수 있는 요청 수(장난 요청이 운영자 시간을 잡아먹지 않게) */
  MAX_OPEN_PER_CONSUMER: 5,
} as const;

/** 거리 막대에서 고를 수 있는 km. 시·도 전체는 distanceKm 없이 wholeSido */
export const QUOTE_REQUEST_DISTANCE_KM = [1, 2, 3, 4, 5, 10, 20] as const;

export const QUOTE_CAKE_SIZE_LABELS: Record<QuoteCakeSize, string> = {
  LUNCHBOX: "도시락",
  MINI: "미니",
  NO1: "1호",
  NO2: "2호",
  NO3: "3호",
  LARGER: "더 큰",
};

export const QUOTE_CREAM_LABELS: Record<QuoteCream, string> = {
  FRESH_CREAM: "생크림",
  BUTTER_CREAM: "버터크림",
  CREAM_CHEESE: "크림치즈",
};

export const QUOTE_REQUEST_ENTRY_LABELS: Record<QuoteRequestEntry, string> = {
  HOME: "홈",
  SEARCH: "검색",
  MAP: "지도",
  STORE: "가게 상세",
  MYPAGE: "MY",
};

export const QUOTE_REQUEST_ERROR_MESSAGES = {
  NOT_FOUND: "견적 요청을 찾을 수 없습니다.",
  INVALID_DATE: "픽업 날짜가 올바르지 않습니다.",
  PAST_DATE: "지난 날짜는 고를 수 없어요.",
  TOO_FAR: "픽업 날짜는 1년 안으로 골라 주세요.",
  INVALID_HOURS: "픽업 시간은 '부터'가 '까지'보다 빨라야 해요.",
  TOO_SOON: "지금부터 3시간 안의 시각은 고를 수 없어요. 날짜나 시간을 다시 골라 주세요.",
  PHOTO_OR_DESCRIPTION_REQUIRED: "참고 사진이나 디자인 설명 중 하나는 꼭 넣어 주세요.",
  AREA_REQUIRED: "받을 동네와 거리를 골라 주세요.",
  DISTANCE_REQUIRED: "거리(km)나 시·도 전체 중 하나를 골라 주세요.",
  SIDO_REQUIRED: "시·도 전체로 물어보려면 동네의 시·도가 필요해요.",
  ONLY_STORE_NEEDS_ONE: "'이 가게에만'은 가게 하나를 넣어야 해요.",
  STORE_TARGET_INVALID: "물어볼 가게는 Picake 가게나 지도의 가게 중 하나여야 해요.",
  STORE_NOT_FOUND: "물어볼 가게 중 찾을 수 없는 가게가 있어요.",
  DUPLICATE_STORE: "같은 가게를 두 번 넣었어요.",
  BUDGET_INVALID: "예산은 1만원부터 10만원까지 1만원 단위로 골라 주세요.",
  TOO_MANY_OPEN: "진행 중인 견적 요청이 많아요. 지난 요청을 닫은 뒤 다시 보내 주세요.",
  NOT_OPEN: "견적을 받는 중인 요청만 닫을 수 있어요.",
} as const;

export const QUOTE_REQUEST_SUCCESS_MESSAGES = {
  CLOSED: "견적 요청을 닫았어요.",
} as const;

/** 손님 목록 탭: 진행 중 / 지난 요청 */
export const QUOTE_REQUEST_LIST_TABS = ["ONGOING", "PAST"] as const;
export type QuoteRequestListTab = (typeof QUOTE_REQUEST_LIST_TABS)[number];
