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
