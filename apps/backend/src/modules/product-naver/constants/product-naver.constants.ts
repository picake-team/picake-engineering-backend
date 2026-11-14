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

/**
 * AI 상세설명 초안 기본 모델. 짧은 문안이라 가장 싼 Haiku로 충분하다(입력·출력 단가가 Sonnet의 1/20).
 * 바꾸려면 서버 환경 변수 ANTHROPIC_DRAFT_MODEL (예: claude-sonnet-5-5)
 */
export const PRODUCT_AI_DRAFT_MODEL = "claude-haiku-5-5";

export const PRODUCT_AI_DRAFT_LIMITS = {
  MAX_NAME_LENGTH: 100,
  MAX_SOURCE_LENGTH: 4000,
  MAX_FACTS_LENGTH: 2000,
  MAX_OPTIONS_LENGTH: 1000,
  /** 초안 3~6문단 + 질문이면 1천 토큰 안팎. 넘치면 잘린 응답 대신 실패로 처리 */
  MAX_OUTPUT_TOKENS: 1500,
  /** 판매자 1명이 하루에 만들 수 있는 초안 수 */
  DAILY_PER_SELLER: 30,
  /**
   * 모든 판매자를 합쳐 하루(한국 시간)에 만들 수 있는 초안 수. 판매자 계정을 여러 개 만들어 부르거나
   * 판매자가 갑자기 많아져도 Claude 비용이 하루 이 횟수(Haiku 한 번 최대 2원 안팎)를 넘지 않게 한다(11-14 운영자)
   */
  DAILY_TOTAL: 300,
};

export const PRODUCT_AI_DRAFT_ERROR_MESSAGES = {
  NOT_CONFIGURED: "AI 초안 기능이 아직 준비되지 않았어요. 상세정보를 직접 입력해 주세요.",
  NO_SOURCE: "AI가 참고할 내용이 없어요. 네이버 설명이나 확인한 사실을 먼저 적어 주세요.",
  DAILY_LIMIT: "오늘 만들 수 있는 AI 초안을 모두 썼어요. 내일 다시 시도하거나 직접 입력해 주세요.",
  FAILED: "AI 초안을 만들지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.",
  /** 모든 판매자를 합친 하루 한도(DAILY_TOTAL)를 다 씀 */
  UNAVAILABLE_TODAY: "오늘은 AI 초안을 더 만들 수 없어요. 상세정보를 직접 입력해 주세요.",
};
