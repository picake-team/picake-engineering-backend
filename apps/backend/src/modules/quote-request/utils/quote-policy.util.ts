import { QuoteRequestStatus } from "@apps/backend/infra/database/prisma/generated/client";
import { QUOTE_LIMITS } from "@apps/backend/modules/quote-request/constants/quote.constants";

/**
 * 견적 ② 규칙 — 저장소 없이 판단만 하는 함수들(기획 I-46·I-11). 서비스가 쓰고 테스트로 지킨다.
 */

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

type RequestTiming = {
  status: QuoteRequestStatus;
  deadlineAt: Date;
  closedAt: Date | null;
  chosenTargetId: string | null;
  chosenAt: Date | null;
};

/** 견적을 받는 중인가(마감 전이고 아직 고르지 않음) */
export function isAccepting(r: RequestTiming, now: Date): boolean {
  return (
    r.status === QuoteRequestStatus.OPEN &&
    !r.chosenTargetId &&
    r.deadlineAt.getTime() > now.getTime()
  );
}

/** 고른 뒤 다른 견적으로 다시 고를 수 있는 마지막 때(고른 뒤 24시간, 마감이 먼저면 마감) */
export function rechooseUntil(r: RequestTiming): Date | null {
  if (!r.chosenAt) return null;
  const byHours = r.chosenAt.getTime() + QUOTE_LIMITS.RECHOOSE_HOURS * MS_HOUR;
  return new Date(Math.min(byHours, r.deadlineAt.getTime()));
}

/**
 * 고른 가게가 답이 없어 막혔나: 손님이 마지막에 쓴 글에 가게가 24시간 답하지 않음.
 * 대화가 없거나 마지막 글이 가게 것이면 막힌 것이 아니다.
 */
export function isStalled(
  thread: { lastMessageSender: string | null; lastConsumerMessageAt: Date | null } | null,
  now: Date,
): boolean {
  if (!thread || thread.lastMessageSender !== "CONSUMER" || !thread.lastConsumerMessageAt)
    return false;
  return (
    now.getTime() - thread.lastConsumerMessageAt.getTime() >= QUOTE_LIMITS.STALL_HOURS * MS_HOUR
  );
}

/**
 * 손님이 이 견적을 고를 수 있나.
 * - 받는 중이면 어느 견적이든
 * - 이미 골랐으면: 다시 고르기 창(24시간) 안이거나, 고른 가게가 답이 없을 때(마감 전) 다른 견적으로
 */
export function canChoose(
  r: RequestTiming,
  targetId: string,
  now: Date,
  chosenStalled: boolean,
): boolean {
  if (r.status === QuoteRequestStatus.CLOSED) return false;
  if (isAccepting(r, now)) return true;
  if (r.status !== QuoteRequestStatus.CONNECTED || !r.chosenTargetId) return false;
  if (r.chosenTargetId === targetId) return false;
  const until = rechooseUntil(r);
  if (until && now.getTime() < until.getTime()) return true;
  return chosenStalled && r.deadlineAt.getTime() > now.getTime();
}

/** 입점 전 가게의 견적 링크 안 대화가 열려 있는 마지막 때(고른 가게 14일, 아니면 마감 뒤 7일) */
export function linkChatOpenUntil(r: RequestTiming, targetId: string): Date {
  if (r.chosenTargetId === targetId && r.chosenAt) {
    return new Date(r.chosenAt.getTime() + QUOTE_LIMITS.LINK_CHAT_DAYS_AFTER_CHOSEN * MS_DAY);
  }
  const end = r.closedAt && r.closedAt < r.deadlineAt ? r.closedAt : r.deadlineAt;
  return new Date(end.getTime() + QUOTE_LIMITS.LINK_CHAT_DAYS_AFTER_CLOSE * MS_DAY);
}

/** 마감 3시간 전에 견적 도착 알림톡을 한 번 더 보낼 때인가 */
export function isReminderDue(
  r: RequestTiming & { arrivalAlimtalkAt: Date | null; reminderAlimtalkAt: Date | null },
  now: Date,
): boolean {
  if (!isAccepting(r, now) || !r.arrivalAlimtalkAt || r.reminderAlimtalkAt) return false;
  const at = r.deadlineAt.getTime() - QUOTE_LIMITS.REMINDER_BEFORE_DEADLINE_HOURS * MS_HOUR;
  return r.arrivalAlimtalkAt.getTime() < at && now.getTime() >= at;
}

/** 손님 화면에 보일 합계(개수가 2개 이상이면 1개 금액 × 개수) */
export function quoteTotal(unitPrice: number, quantity: number): number {
  return unitPrice * Math.max(1, quantity);
}

export type QuoteTargetStateValue =
  | "OPEN"
  | "SENT"
  | "DECLINED"
  | "CHOSEN_ME"
  | "CHOSEN_OTHER"
  | "CLOSED"
  | "FULL";

/**
 * 물어본 가게 한 곳 쪽에서 본 지금 상태(견적 링크·판매자 앱 요청서 카드·관리자 한 줄이 같은 판단).
 * 고름 → 마감 → 보냄 → 어려워요 → 다 모임 → 받는 중 순서로 본다.
 */
export function targetState(input: {
  request: RequestTiming;
  targetId: string;
  declinedAt: Date | null;
  hasQuote: boolean;
  quoteCount: number;
  now: Date;
}): QuoteTargetStateValue {
  const { request: r } = input;
  if (r.chosenTargetId === input.targetId) return "CHOSEN_ME";
  if (r.chosenTargetId) return "CHOSEN_OTHER";
  if (!isAccepting(r, input.now)) return "CLOSED";
  if (input.hasQuote) return "SENT";
  if (input.declinedAt) return "DECLINED";
  if (input.quoteCount >= QUOTE_LIMITS.MAX_QUOTES) return "FULL";
  return "OPEN";
}
