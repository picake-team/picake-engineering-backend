/** 네이버 상품 가져오기 에러 메시지 */
export const PRODUCT_NAVER_ERROR_MESSAGES = {
  ITEM_KEY_INVALID: "가져올 네이버 상품을 확인해 주세요.",
  NOT_LINKED: "이 상품은 네이버 상품과 연결돼 있지 않아요.",
  MENU_CANNOT_LINK: "네이버 메뉴는 연결할 수 없어요. 네이버 예약 상품만 연결할 수 있어요.",
};

/** 목록 항목 키: 예약 상품은 숫자 ID, 상품 안의 옵션 하나는 "상품ID-o옵션ID", 메뉴는 menu-순번 */
export const NAVER_PRODUCT_ITEM_KEY_REGEX = /^(\d{1,15}(-o\d{1,15})?|menu-\d{1,3})$/;

/** 옵션 하나를 상품으로 가져오는 키 ("상품ID-o옵션ID") */
export const NAVER_OPTION_ITEM_KEY_REGEX = /^(\d{1,15})-o(\d{1,15})$/;

/** 목록에 보여 줄 설명 길이 */
export const NAVER_PRODUCT_SUMMARY_LENGTH = 60;

/** AI 상세설명 초안 설정 */
export const PRODUCT_AI_DRAFT_MODEL = "claude-sonnet-5-5";

export const PRODUCT_AI_DRAFT_LIMITS = {
  MAX_NAME_LENGTH: 100,
  MAX_SOURCE_LENGTH: 4000,
  MAX_FACTS_LENGTH: 2000,
  MAX_OPTIONS_LENGTH: 1000,
  MAX_OUTPUT_TOKENS: 2000,
  /** 판매자 1명이 하루에 만들 수 있는 초안 수 */
  DAILY_PER_SELLER: 30,
};

export const PRODUCT_AI_DRAFT_ERROR_MESSAGES = {
  NOT_CONFIGURED: "AI 초안 기능이 아직 준비되지 않았어요. 상세정보를 직접 입력해 주세요.",
  NO_SOURCE: "AI가 참고할 내용이 없어요. 네이버 설명이나 확인한 사실을 먼저 적어 주세요.",
  DAILY_LIMIT: "오늘 만들 수 있는 AI 초안을 모두 썼어요. 내일 다시 시도하거나 직접 입력해 주세요.",
  FAILED: "AI 초안을 만들지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.",
};
