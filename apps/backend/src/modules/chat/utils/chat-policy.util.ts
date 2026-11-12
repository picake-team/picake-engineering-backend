import {
  CHAT_BLOCKED_WORDS,
  CHAT_LIMITS,
} from "@apps/backend/modules/chat/constants/chat.constants";

/**
 * 채팅 규칙(기획 I-11) — 저장소 없이 판단만 하는 함수들. 서비스가 쓰고, 테스트로 지킨다.
 */

const MS_DAY = 24 * 60 * 60 * 1000;

/** 서울 시각(0~23시) */
export function seoulHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
}

/** 밤 9시~아침 8시(서울)인가 */
export function isSeoulNight(now: Date): boolean {
  const h = seoulHour(now);
  return h >= CHAT_LIMITS.NIGHT_START_HOUR || h < CHAT_LIMITS.NIGHT_END_HOUR;
}

/** 욕설을 ●로 가린다. 가린 것이 없으면 null(원문을 그대로 보여 줌) */
export function maskBlockedWords(text: string): string | null {
  let masked = text;
  let hit = false;
  for (const word of CHAT_BLOCKED_WORDS) {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    masked = masked.replace(re, (m) => {
      hit = true;
      return "●".repeat(m.length);
    });
  }
  return hit ? masked : null;
}

/** 목록·휴대폰 알림에 보일 미리보기(거른 글 앞 40자, 사진만이면 "사진을 보냈어요") */
export function buildPreview(input: {
  text?: string | null;
  maskedText?: string | null;
  imageCount: number;
  kind?: string;
}): string {
  if (input.kind === "ORDER") return "주문에 대해 문의했어요";
  if (input.kind === "PRODUCT") return "상품에 대해 문의했어요";
  const shown = (input.maskedText ?? input.text ?? "").replace(/\s+/g, " ").trim();
  if (!shown) return input.imageCount > 0 ? "사진을 보냈어요" : "";
  return shown.length > CHAT_LIMITS.PREVIEW_MAX
    ? `${shown.slice(0, CHAT_LIMITS.PREVIEW_MAX)}…`
    : shown;
}

export type ShopWriteDecision =
  | { ok: true }
  | { ok: false; reason: "SHOP_LEFT" | "BLOCKED" | "CONSUMER_GONE" | "LOCKED" };

/**
 * 가게가 이 방에 쓸 수 있나(한 줄 규칙).
 * 방이 열려 있고(가게가 Picake에 있고, 차단 없음, 손님 탈퇴 아님) —
 * ① 손님 마지막 글이 30일 안이거나 ② 이 가게와 픽업 전 예약이 있을 때.
 * (견적이 살아 있을 때 ③은 견적 ②와 함께 붙인다)
 */
export function decideShopWrite(input: {
  now: Date;
  shopHasStore: boolean;
  blockedByConsumer: boolean;
  blockedByShop: boolean;
  consumerWithdrawn: boolean;
  lastConsumerMessageAt: Date | null;
  hasActiveOrder: boolean;
}): ShopWriteDecision {
  if (!input.shopHasStore) return { ok: false, reason: "SHOP_LEFT" };
  if (input.consumerWithdrawn) return { ok: false, reason: "CONSUMER_GONE" };
  if (input.blockedByConsumer || input.blockedByShop) return { ok: false, reason: "BLOCKED" };
  if (input.hasActiveOrder) return { ok: true };
  if (
    input.lastConsumerMessageAt &&
    input.now.getTime() - input.lastConsumerMessageAt.getTime() <=
      CHAT_LIMITS.SHOP_WRITE_WINDOW_DAYS * MS_DAY
  ) {
    return { ok: true };
  }
  return { ok: false, reason: "LOCKED" };
}

/** 손님이 이 방에 쓸 수 있나 */
export function decideConsumerWrite(input: {
  shopHasStore: boolean;
  blockedByConsumer: boolean;
  blockedByShop: boolean;
}): { ok: true } | { ok: false; reason: "SHOP_LEFT" | "BLOCKED" } {
  if (!input.shopHasStore) return { ok: false, reason: "SHOP_LEFT" };
  if (input.blockedByConsumer || input.blockedByShop) return { ok: false, reason: "BLOCKED" };
  return { ok: true };
}

/**
 * 받는 사람에게 지금 휴대폰 알림을 보낼까.
 * 알림을 껐거나, 이 방 알림을 껐거나, 20초 안에 방을 봤으면 보내지 않는다.
 * quietNight는 사장님의 "밤 9시~아침 8시는 채팅 알림 끄기".
 */
export function shouldPushNow(input: {
  now: Date;
  enabled: boolean;
  muted: boolean;
  seenAt: Date | null;
  quietNight?: boolean;
}): boolean {
  if (!input.enabled || input.muted) return false;
  if (
    input.seenAt &&
    input.now.getTime() - input.seenAt.getTime() < CHAT_LIMITS.SEEN_SUPPRESS_SECONDS * 1000
  ) {
    return false;
  }
  if (input.quietNight && isSeoulNight(input.now)) return false;
  return true;
}

/**
 * 안 읽은 채팅에 알림톡을 보낼 때인가(1분마다 도는 일에서).
 * 앱 알림을 받을 기기가 없으면 10분, 있으면 60분 뒤. 방마다 3시간에 한 번, 밤에는 아침까지 미룸.
 */
export function isAlimtalkDue(input: {
  now: Date;
  enabled: boolean;
  muted: boolean;
  lastIncomingAt: Date;
  readAt: Date | null;
  notifiedAt: Date | null;
  hasPushDevice: boolean;
}): boolean {
  if (!input.enabled || input.muted) return false;
  if (input.readAt && input.readAt >= input.lastIncomingAt) return false;
  const waitMin = input.hasPushDevice
    ? CHAT_LIMITS.ALIMTALK_AFTER_MINUTES_WITH_PUSH
    : CHAT_LIMITS.ALIMTALK_AFTER_MINUTES_NO_PUSH;
  if (input.now.getTime() - input.lastIncomingAt.getTime() < waitMin * 60 * 1000) return false;
  if (
    input.notifiedAt &&
    input.now.getTime() - input.notifiedAt.getTime() <
      CHAT_LIMITS.ALIMTALK_MIN_GAP_HOURS * 3600 * 1000
  ) {
    return false;
  }
  if (input.notifiedAt && input.notifiedAt >= input.lastIncomingAt) return false;
  if (isSeoulNight(input.now)) return false;
  return true;
}

/** 안 읽음: 마지막 글이 상대 것이고 내가 그 뒤에 읽지 않았으면 */
export function isUnreadFor(
  side: "CONSUMER" | "SHOP",
  thread: {
    lastMessageAt: Date | null;
    lastMessageSender: string | null;
    consumerReadAt: Date | null;
    shopReadAt: Date | null;
  },
): boolean {
  if (!thread.lastMessageAt || !thread.lastMessageSender) return false;
  if (thread.lastMessageSender === side) return false;
  const readAt = side === "CONSUMER" ? thread.consumerReadAt : thread.shopReadAt;
  return !readAt || readAt < thread.lastMessageAt;
}
