/**
 * 직접 적은 주문(기획 I-42): 사장님이 Picake 밖(카톡·인스타·전화 등)에서 받은 주문을 판매자 앱에 적는다.
 * Picake 주문과 같은 달력·같은 목록에 보이지만 다른 표(manual_orders)라 알림톡·수수료·정산·관리자 숫자와 섞지 않는다.
 */

export const MANUAL_ORDER_LIMITS = {
  CAKE_NAME_MAX: 100,
  LETTERING_MAX: 100,
  CUSTOMER_NAME_MAX: 50,
  MEMO_MAX: 500,
  /** 1,000만 원. 잘못 친 0을 막는다 */
  PRICE_MAX: 10_000_000,
  PHOTO_MAX: 3,
  /** 한 번에 불러오는 기간(달력 한 달 + 앞뒤 주) */
  LIST_MAX_DAYS: 62,
  /** 가게마다 적어 둘 수 있는 주문 수(잘못 돌린 스크립트가 표를 채우지 않게) */
  PER_STORE_MAX: 5_000,
} as const;

export const MANUAL_ORDER_ERROR_MESSAGES = {
  NOT_FOUND: "직접 적은 주문을 찾을 수 없어요.",
  STORE_NOT_OWNED: "내 스토어가 아니에요.",
  INVALID_DATE: "픽업 날짜를 골라 주세요.",
  INVALID_TIME: "시간은 00:00처럼 적어 주세요.",
  CAKE_NAME_REQUIRED: "케이크를 적어 주세요.",
  INVALID_PRICE: "금액은 0원부터 10,000,000원까지 적을 수 있어요.",
  TOO_MANY_PHOTOS: "사진은 3장까지 붙일 수 있어요.",
  INVALID_PHOTO: "사진을 다시 올려 주세요.",
  INVALID_RANGE: "기간을 다시 골라 주세요.",
  TOO_MANY: "적어 둔 주문이 너무 많아요. 지난 주문을 지운 뒤 다시 적어 주세요.",
} as const;

/**
 * 대화 읽기(기획 I-42 "대화 붙여 넣어 채우기"): 사장님이 붙여 넣은 대화 글이나 대화 캡처를 Claude가 읽어 주문 칸을 채운다.
 * 대화·캡처는 저장하지 않고, 로그에는 횟수·시간·토큰만 남긴다(견적 사진 읽기와 같은 방식).
 */
export const MANUAL_ORDER_READ_MODEL = "claude-haiku-5-5";

export const MANUAL_ORDER_READ_LIMITS = {
  /** 붙여 넣은 대화 글(이보다 길면 앞부분이 아니라 뒷부분 — 최근 대화 — 을 읽는다) */
  TEXT_MAX_CHARS: 6_000,
  /** 캡처는 웹이 1600px·품질 0.8로 줄여 보낸다. 풀었을 때 이보다 크면 받지 않는다 */
  MAX_IMAGE_BYTES: Math.floor(2.5 * 1024 * 1024),
  /** 하루(한국 시간) 사장님마다 */
  DAILY_PER_SELLER: 60,
  /** 하루(한국 시간) 모든 사장님을 합쳐. 넘으면 키가 없을 때와 같은 503 */
  DAILY_TOTAL: 2_000,
  /** 분당(접속 주소마다) */
  PER_MINUTE: 10,
  /** Claude 한 번을 기다리는 최대 시간(다시 시도하지 않음). 웹은 30초 기다린다 */
  CLAUDE_TIMEOUT_MS: 20_000,
  MAX_OUTPUT_TOKENS: 1024,
  /** 캡처를 받는 이 경로만 JSON 본문 한도를 올린다 */
  BODY_LIMIT: "4mb",
} as const;

export const MANUAL_ORDER_READ_ERROR_MESSAGES = {
  EMPTY: "붙여 넣을 대화가 없어요. 대화를 복사한 뒤 다시 눌러 주세요.",
  INVALID_IMAGE: "JPG나 PNG 사진만 읽을 수 있어요. 다른 캡처로 다시 시도해 주세요.",
  TOO_LARGE: "캡처가 너무 커요. 더 작은 캡처로 다시 시도해 주세요.",
  DAILY_LIMIT: "오늘은 대화 읽기를 다 썼어요. 직접 적어 주세요.",
  TOO_FAST: "잠시 후 다시 시도해 주세요.",
  UNAVAILABLE: "지금은 대화를 읽을 수 없어요. 직접 적어 주세요.",
  FAILED: "대화를 읽지 못했어요. 잠시 후 다시 시도하거나 직접 적어 주세요.",
} as const;

/** 다른 캘린더로 내보내기(아이폰·구글 캘린더가 구독하는 ics 주소) */
export const CALENDAR_FEED = {
  /** 지난 주문은 이만큼만(구독한 캘린더가 무거워지지 않게) */
  PAST_DAYS: 60,
  /** 앞으로 이만큼 */
  FUTURE_DAYS: 366,
  /** 시간을 적지 않은 주문은 하루 일정, 시간이 있으면 이만큼 */
  EVENT_MINUTES: 30,
  /** 구독한 캘린더가 다시 읽는 간격(지키는 앱만) */
  REFRESH_MINUTES: 60,
  /** 주소에 넣는 비밀 값 길이(바이트, base64url) */
  TOKEN_BYTES: 24,
} as const;

export const CALENDAR_FEED_ERROR_MESSAGES = {
  NOT_FOUND: "캘린더 주소를 찾을 수 없어요.",
} as const;
