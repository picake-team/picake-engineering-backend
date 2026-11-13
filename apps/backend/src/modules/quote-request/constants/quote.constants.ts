import {
  OrderStatus,
  QuoteDeclineReason,
  QuoteSimilarity,
} from "@apps/backend/infra/database/prisma/generated/client";

/**
 * 가게 견적(기획 I-46 ②, 운영자 결정 2026-11-12: 견적 링크·대신 적기·판매자 앱 채팅에서 받기).
 */
export const QUOTE_LIMITS = {
  /** 한 요청에 받는 견적(금액을 보낸 것만 센다, 운영자 결정 2026-11-08) */
  MAX_QUOTES: 5,
  UNIT_PRICE_MIN: 1_000,
  UNIT_PRICE_MAX: 10_000_000,
  MEMO_MAX_LENGTH: 200,
  MAX_PHOTOS: 3,
  /** 고른 뒤 이 시간 안에는 다른 견적으로 다시 고를 수 있다(픽업 1시간 전이 먼저 오면 그때까지) */
  RECHOOSE_HOURS: 24,
  /** 고른 가게가 손님 마지막 글에 이 시간 답이 없으면 다시 고르기가 열리고 운영자에게 알린다 */
  STALL_HOURS: 24,
  /** 입점 전 가게 견적 링크 안 대화가 열려 있는 기간 */
  LINK_CHAT_DAYS_AFTER_CHOSEN: 14,
  LINK_CHAT_DAYS_AFTER_CLOSE: 7,
  /** 첫 견적 알림톡을 이보다 먼저 보냈고 아직 안 골랐으면, 마감 이 시간 전에 한 번 더 */
  REMINDER_BEFORE_DEADLINE_HOURS: 3,
  /** 입점 전 가게가 손님 글에 이 시간 답이 없으면 운영자 디스코드(방마다 하루 한 번) */
  UNENTERED_NO_REPLY_MINUTES: 60,
  LINK_TOKEN_BYTES: 24,
  /** 견적을 고친 지 이 시간 안에 또 고치면 "견적이 바뀌었어요" 알림을 다시 보내지 않는다(알림 폭탄 막기) */
  EDIT_NOTIFY_GAP_MINUTES: 10,
  /** 마감·알림톡·운영자 알림을 확인하는 간격 */
  JOB_INTERVAL_MS: 5 * 60 * 1000,
} as const;

/** 주문 받는 곳 종류. 쓰지 않음(11-12 운영자: 채팅에서 정함) — 옛 화면 호환용 입력 칸 크기에만 남김 */
export const QUOTE_CONTACT_TYPES = ["KAKAO", "INSTAGRAM", "PHONE", "NAVER"] as const;
export type QuoteContactType = (typeof QUOTE_CONTACT_TYPES)[number];

export const QUOTE_SIMILARITY_LABELS: Record<QuoteSimilarity, { label: string; detail: string }> = {
  EXACT: { label: "거의 똑같이", detail: "모양·색·글씨까지 사진대로 만들어요" },
  SIMILAR: {
    label: "비슷하게",
    detail: "전체 모양과 색은 같고, 캐릭터 표정·장식은 가게 솜씨대로 만들어요",
  },
  INSPIRED: { label: "느낌만 살려서", detail: "색과 분위기를 살려 가게 디자인으로 만들어요" },
};

export const QUOTE_DECLINE_REASON_LABELS: Record<QuoteDeclineReason, string> = {
  FULLY_BOOKED: "그날 주문이 꽉 찼어요",
  NOT_OUR_STYLE: "이런 디자인은 만들지 않아요",
  BUDGET: "예산으로는 어려워요",
  OTHER: "다른 이유",
};

/** 견적 알림톡(카카오 승인 2026-11-10). 기획 I-46 "견적 보기·고르기" */
export const QUOTE_ALIMTALK_TEMPLATE_IDS = {
  ARRIVED: "KA01TP261109114820481kF42CymJruH",
  CLOSED_NO_QUOTE: "KA01TP261109114822796CCF02QoZjpw",
} as const;

/** 휴대폰 알림 제목(손님) */
export const QUOTE_PUSH_TITLES = {
  ARRIVED: "견적이 도착했어요",
  EDITED: "견적이 바뀌었어요",
  CLOSED_NO_QUOTE: "견적 요청이 마감됐어요",
} as const;

/** 판매자 앱 휴대폰 알림 제목(주문 알림과 같은 말투). 웹 toast-icon.util이 이 글로 아이콘을 고른다 */
export const SELLER_QUOTE_PUSH_TITLES = {
  REQUEST: "새 견적 요청이 왔어요",
  CHOSEN: "손님이 견적을 골랐어요",
} as const;

/** 견적으로 만든 예약이 살아 있는 상태(취소된 예약만 빼고). 있으면 다시 예약·다시 고르기·견적 고치기를 막는다 */
export const QUOTE_RESERVATION_ACTIVE_STATUSES = [
  OrderStatus.RESERVATION_REQUESTED,
  OrderStatus.PAYMENT_PENDING,
  OrderStatus.PAYMENT_COMPLETED,
  OrderStatus.CONFIRMED,
  OrderStatus.PICKUP_PENDING,
  OrderStatus.PICKUP_COMPLETED,
  OrderStatus.NO_SHOW,
] as const;

export const QUOTE_ERROR_MESSAGES = {
  RESERVE_NOT_CHOSEN: "먼저 견적을 골라 주세요.",
  RESERVE_UNENTERED: "Picake에 입점한 가게만 예약할 수 있어요. 가게와 채팅으로 정해 주세요.",
  RESERVE_CLOSED: "끝난 요청이라 예약할 수 없어요.",
  RESERVE_PRICE_CHANGED: "사장님이 견적을 고쳤어요. 바뀐 금액을 확인하고 다시 예약해 주세요.",
  RESERVED_CANNOT_RECHOOSE:
    "이 견적으로 예약했어요. 다른 견적을 고르려면 예약을 먼저 취소해 주세요.",
  LINK_NOT_FOUND: "견적 링크를 찾을 수 없어요. 링크를 다시 확인해 주세요.",
  TARGET_NOT_FOUND: "물어본 가게를 찾을 수 없어요.",
  QUOTE_NOT_FOUND: "견적을 찾을 수 없어요.",
  NOT_ACCEPTING: "이 요청은 지금 견적을 받지 않아요.",
  ALREADY_CHOSEN: "손님이 이미 견적을 골라 고칠 수 없어요.",
  FULL: "이 요청은 견적이 다 모였어요.",
  PRICE_INVALID: "금액은 1,000원부터 1,000만 원까지 숫자로 적어 주세요.",
  PHOTO_INVALID: "사진은 올린 사진만 3장까지 넣을 수 있어요.",
  CANNOT_CHOOSE: "지금은 이 견적을 고를 수 없어요.",
  NOT_UNENTERED: "Picake에 입점한 가게는 판매자 앱에서 견적을 보내요.",
  STORE_ALREADY_ADDED: "이미 물어본 가게예요.",
  ONLY_STORE_REQUEST: "손님이 이 가게에만 물어보기로 한 요청이에요.",
  NOT_CHOSEN_UNENTERED: "손님이 입점 전 가게를 고른 요청만 알릴 수 있어요.",
  CHAT_CLOSED: "대화 기간이 끝났어요.",
} as const;
