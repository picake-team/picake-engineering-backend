export const FCM_PUSH_TYPE = {
  ORDER_NOTIFICATION: "ORDER_NOTIFICATION",
  /** 판매자 앱 주문 알림. data에 storeId·orderId·path가 들어간다 */
  SELLER_ORDER: "SELLER_ORDER",
  /** 판매자 앱 테스트 알림 (알림 설정의 "테스트 알림 보내기") */
  SELLER_TEST: "SELLER_TEST",
  /** 판매자 앱 아침 요약(매일 8시, 그날 픽업이 있을 때만). data에 storeId·path(홈)가 들어간다 */
  SELLER_MORNING_SUMMARY: "SELLER_MORNING_SUMMARY",
  /** 손님 채팅 알림(기획 I-11). data에 threadId·path(/chat/:threadId)가 들어간다 — 손님 앱이 path로 이동하려면 앱 수정 필요 */
  CHAT_MESSAGE: "CHAT_MESSAGE",
  /** 판매자 앱 채팅 알림. data에 storeId·threadId·path가 들어간다 */
  SELLER_CHAT: "SELLER_CHAT",
  /** 손님 견적 알림(기획 I-46 ②). data에 quoteRequestId·path(/quote/:id)가 들어간다 */
  QUOTE: "QUOTE",
} as const;

export const FCM_ANDROID_CHANNEL_ID = {
  ORDER_NOTIFICATION: "order_notifications",
} as const;

export const FCM_MAX_MULTICAST_TOKENS = 500;

export type FcmPushType = (typeof FCM_PUSH_TYPE)[keyof typeof FCM_PUSH_TYPE];

export interface SendConsumerPushParams {
  consumerId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  androidChannelId?: string;
}

export interface SendConsumerOrderPushParams {
  consumerId: string;
  title: string;
  body: string;
  orderId: string;
}

export interface SendFcmTokensParams {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  androidChannelId?: string;
}

export interface SendFcmTokensResult {
  invalidTokens: string[];
  /** FCM이 받아들인 토큰 수 (실패·무효 제외) */
  successCount: number;
}

export interface SendSellerPushParams {
  sellerId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  androidChannelId?: string;
}

export interface SendSellerOrderPushParams {
  sellerId: string;
  storeId: string;
  orderId: string;
  title: string;
  body: string;
}

/** 판매자 웹 스토어 홈 경로(아침 요약을 누르면 열림). web-seller `ROUTES.STORE_DETAIL_HOME`과 같아야 합니다. */
export function buildSellerHomePath(storeId: string): string {
  return `/stores/${encodeURIComponent(storeId)}`;
}

/**
 * 판매자 웹의 주문 상세 경로. 판매자 앱 푸시의 `data.path`로 보내며,
 * web-seller `ROUTES.STORE_DETAIL_ORDERS_DETAIL`과 같아야 합니다.
 */
export function buildSellerOrderPath(storeId: string, orderId: string): string {
  return `/stores/${encodeURIComponent(storeId)}/orders/${encodeURIComponent(orderId)}`;
}
