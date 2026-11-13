export const REVIEW_ERROR_MESSAGES = {
  REVIEW_NOT_FOUND: "후기를 찾을 수 없어요.",
  REVIEW_IMAGE_URL_INVALID: "후기 사진은 업로드한 사진만 넣을 수 있어요.",
  REVIEW_FORBIDDEN: "본인이 작성한 후기만 삭제할 수 있어요.",
  REVIEW_ORDER_NOT_ELIGIBLE: "픽업이 완료된 주문에만 후기를 작성할 수 있어요.",
  REVIEW_QUOTE_ORDER: "견적으로 만든 예약은 아직 후기를 쓸 수 없어요.",
  REVIEW_ALREADY_WRITTEN: "해당 주문에 대한 후기가 이미 등록되어 있어요.",
  REVIEW_REVOKED_CANNOT_REWRITE: "삭제한 후기는 동일 주문으로 다시 작성할 수 없어요.",
} as const;

export const REVIEW_SUCCESS_MESSAGES = {
  REVIEW_DELETED: "후기가 삭제됐어요.",
} as const;

export enum ReviewSortBy {
  LATEST = "latest", // 최신순(생성일 내림차순)
  RATING_DESC = "rating_desc", // 별점 내림차순
  RATING_ASC = "rating_asc", // 별점 오름차순
}
