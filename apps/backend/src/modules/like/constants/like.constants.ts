/**
 * 디자인 좋아요 한도(케이크 디자인 모음, 기획 I-112). 서버는 디자인 ID 모양만 보므로
 * 아무 ID나 끝없이 쌓거나 수 조회가 커지지 않게 막는다
 */
export const DESIGN_LIKE_LIMITS = {
  /** 손님 한 명이 좋아요할 수 있는 디자인 수(모음은 수십 장이라 넉넉하다) */
  MAX_PER_CONSUMER: 300,
  /** 좋아요 수를 돌려주는 디자인 수(많은 순). 모음보다 훨씬 많아 실제 디자인은 다 들어간다 */
  COUNTS_TOP: 500,
} as const;

/**
 * 좋아요 관련 에러 메시지
 */
export const LIKE_ERROR_MESSAGES = {
  PRODUCT_LIKE_ALREADY_EXISTS: "이미 좋아요한 상품이에요.",
  PRODUCT_LIKE_NOT_FOUND: "좋아요한 상품이 아닙니다.",
  STORE_LIKE_ALREADY_EXISTS: "이미 좋아요한 스토어예요.",
  STORE_LIKE_NOT_FOUND: "좋아요한 스토어가 아닙니다.",
  /** 디자인 ID 모양이 틀림(케이크 디자인 모음, 기획 I-112 — 디자인은 웹에 있어 서버는 모양만 본다) */
  DESIGN_NOT_FOUND: "디자인을 찾을 수 없어요.",
  /** 손님 한 명의 디자인 좋아요가 한도(DESIGN_LIKE_LIMITS.MAX_PER_CONSUMER)에 닿음 */
  DESIGN_LIKE_LIMIT: `좋아요는 ${DESIGN_LIKE_LIMITS.MAX_PER_CONSUMER}개까지 할 수 있어요.`,
} as const;

/**
 * 좋아요 관련 성공 메시지 상수
 */
export const LIKE_SUCCESS_MESSAGES = {
  PRODUCT_LIKE_ADDED: "상품에 좋아요를 추가했어요.",
  PRODUCT_LIKE_REMOVED: "상품 좋아요를 취소했어요.",
  STORE_LIKE_ADDED: "스토어에 좋아요를 추가했어요.",
  STORE_LIKE_REMOVED: "스토어 좋아요를 취소했어요.",
  DESIGN_LIKE_ADDED: "디자인에 좋아요를 추가했어요.",
  DESIGN_LIKE_REMOVED: "디자인 좋아요를 취소했어요.",
} as const;

/**
 * 좋아요 타입 enum
 */
export enum LikeType {
  PRODUCT = "PRODUCT", // 상품 좋아요
  STORE = "STORE", // 스토어 좋아요
}
