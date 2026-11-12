/**
 * 채팅(기획 I-11) 규칙 숫자와 문구. 웹(web-user·web-seller)의 같은 숫자와 맞춘다.
 */
export const CHAT_LIMITS = {
  /** 글 한 개 최대 글자 수 */
  TEXT_MAX: 1000,
  /** 한 번에 보낼 수 있는 사진 수 */
  IMAGES_MAX: 5,
  /** 한 방에서 한 사람이 1분에 보낼 수 있는 글 수(도배 막기) */
  SEND_PER_MINUTE: 20,
  /** 손님이 하루에 새로 열 수 있는 방 수 */
  NEW_THREADS_PER_DAY: 20,
  /** 하루 신고 수 */
  REPORTS_PER_DAY: 10,
  /** 목록·글 한 번에 가져오는 수 */
  PAGE_SIZE: 30,
  /** 미리보기 글자 수 */
  PREVIEW_MAX: 40,
  /** 가게가 쓸 수 있는 기간: 손님 마지막 글 뒤 30일(동의 없는 광고 막기, 정보통신망법 제50조) */
  SHOP_WRITE_WINDOW_DAYS: 30,
  /** 이만큼 안에 방을 본 사람에게는 휴대폰 알림을 보내지 않음 */
  SEEN_SUPPRESS_SECONDS: 20,
  /** 보고 있음(seenAt)은 이 간격보다 자주 저장하지 않음 */
  SEEN_WRITE_INTERVAL_SECONDS: 10,
  /** 앱 알림을 받을 기기가 없을 때 알림톡까지 기다리는 분 */
  ALIMTALK_AFTER_MINUTES_NO_PUSH: 10,
  /** 앱 알림을 받는 사람도 이만큼 안 읽으면 알림톡 한 번 */
  ALIMTALK_AFTER_MINUTES_WITH_PUSH: 60,
  /** 방마다 알림톡 최소 간격(시간) */
  ALIMTALK_MIN_GAP_HOURS: 3,
  /** 채팅 알림톡 하루 전체 상한(버그로 계속 보내 비용이 새는 것 막기) */
  ALIMTALK_DAILY_CAP: 200,
  /** 밤(서울 시간): 이 시각부터 */
  NIGHT_START_HOUR: 21,
  /** 밤(서울 시간): 이 시각까지 */
  NIGHT_END_HOUR: 8,
} as const;

/** 채팅 이용 규칙 버전. 규칙 글이 바뀌면 올려서 다시 동의받는다 */
export const CHAT_RULES_VERSION = 1;

/** 알림톡 템플릿 ID — 카카오 검수 승인 뒤 넣는다(운영자 확인 전, 비어 있으면 보내지 않음) */
export const CHAT_ALIMTALK_TEMPLATE_IDS = {
  /** 손님: 문의하신 가게에서 답변 메시지가 도착 */
  CONSUMER_REPLY: "",
  /** 사장님: 새 문의 */
  SELLER_NEW_MESSAGE: "",
} as const;

/** 판매자 앱 휴대폰 알림 제목(주문 알림과 같은 말투). 웹 toast-icon.util이 이 글로 아이콘을 고른다 — 바꾸면 웹도 같이 */
export const SELLER_CHAT_PUSH_TITLE = "새 문의가 왔어요";

export const CHAT_ERROR_MESSAGES = {
  THREAD_NOT_FOUND: "채팅을 찾을 수 없어요.",
  STORE_NOT_FOUND: "스토어를 찾을 수 없어요.",
  STORE_NOT_OWNED: "이 스토어의 채팅이 아니에요.",
  ORDER_NOT_FOUND: "주문을 찾을 수 없어요.",
  PRODUCT_NOT_FOUND: "상품을 찾을 수 없어요.",
  EMPTY_MESSAGE: "보낼 글이나 사진을 넣어 주세요.",
  TEXT_TOO_LONG: `글은 ${CHAT_LIMITS.TEXT_MAX.toLocaleString()}자까지 보낼 수 있어요.`,
  TOO_MANY_IMAGES: `사진은 한 번에 ${CHAT_LIMITS.IMAGES_MAX}장까지 보낼 수 있어요.`,
  INVALID_IMAGE: "사진은 업로드한 사진만 보낼 수 있어요.",
  RULES_NOT_AGREED: "채팅 이용 규칙에 동의한 뒤 보낼 수 있어요.",
  CANNOT_SEND: "지금은 메시지를 보낼 수 없어요.",
  /** 내가 차단한 방(상대가 나를 차단한 건 알리지 않고 CANNOT_SEND) */
  BLOCKED_BY_ME: "차단한 대화예요. 위쪽 ⋯에서 차단을 풀 수 있어요.",
  SHOP_LEFT: "가게가 Picake 채팅을 쓰지 않아요.",
  /** 왜 못 보내는지 한 줄(운영자 11-12): 손님 마지막 글 30일이 지났거나 손님이 말한 적이 없고, 픽업 전 예약도 없을 때 */
  SHOP_LOCKED:
    "손님 글이 30일 넘게 없고 픽업 전 예약도 없어 먼저 보낼 수 없어요. 손님이 먼저 말하면 다시 보낼 수 있어요.",
  TOO_FAST: "너무 빨리 보내고 있어요. 잠시 뒤에 보내 주세요.",
  TOO_MANY_THREADS: "오늘은 새 채팅을 더 열 수 없어요. 내일 다시 해 주세요.",
  TOO_MANY_REPORTS: "오늘은 신고를 더 할 수 없어요. 고객센터로 알려 주세요.",
  ORDER_NOT_ACTIVE: "픽업 전 예약이 있을 때만 먼저 채팅할 수 있어요.",
  REPORT_NOT_FOUND: "신고를 찾을 수 없어요.",
} as const;

/**
 * 보낼 때 가리는 말(애플 1.2 "불쾌한 내용 거르기"). 원문은 신고 확인용으로만 남긴다.
 * 너무 넓게 잡으면 평범한 말도 가려지므로 분명한 욕설만 둔다. 늘릴 때는 테스트도 같이.
 */
export const CHAT_BLOCKED_WORDS: readonly string[] = [
  "씨발",
  "시발",
  "씨팔",
  "ㅅㅂ",
  "ㅆㅂ",
  "병신",
  "ㅂㅅ",
  "개새끼",
  "개새기",
  "좆",
  "존나",
  "졸라",
  "미친놈",
  "미친년",
  "썅",
  "fuck",
  "shit",
];
