import { QuoteRequestStatus } from "@apps/backend/infra/database/prisma/generated/client";
import {
  QUOTE_CONTACT_TYPES,
  QUOTE_LIMITS,
  type QuoteContactType,
} from "@apps/backend/modules/quote-request/constants/quote.constants";

/**
 * 견적 ② 규칙 — 저장소 없이 판단만 하는 함수들(기획 I-46·I-11). 서비스가 쓰고 테스트로 지킨다.
 */

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

export interface QuoteContact {
  type: QuoteContactType;
  value: string;
}

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

/**
 * 가게가 손님이 쓴 내용(설명·요청 사항·참고 사진)을 볼 수 있나.
 * 처리방침 v1.3 제3조 ②의 보유 기간("견적 요청이 마감될 때까지")에 맞춰, 끝난 요청(마감·닫힘·다른 가게를 고름)에서는
 * 가리고, 고른 가게는 케이크를 만들어야 하니 손님 "진행 중"과 같이 픽업 시작 24시간 뒤까지 보인다.
 */
export function shopCanSeeRequestContent(
  state: QuoteTargetStateValue,
  pickupStartAt: Date,
  now: Date,
): boolean {
  if (state === "CHOSEN_ME") return now.getTime() < pickupStartAt.getTime() + 24 * MS_HOUR;
  return state !== "CLOSED" && state !== "CHOSEN_OTHER";
}

/** 휴대폰 번호를 010-1234-5678 모양으로(숫자가 아니면 그대로) */
export function formatPhone(phone: string): string {
  const d = phone.replace(/[^0-9]/g, "");
  if (/^01[016789]\d{7,8}$/.test(d)) {
    return d.length === 11
      ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
      : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return phone;
}

/**
 * 가게 쪽에 보일 손님 이름·휴대폰. 보낼 때 안내를 보고 보낸 요청에만, 탈퇴한 손님은 없음.
 * 이름이 없으면 닉네임. 보이는 기간은 손님 글과 같다(부르는 곳에서 shopCanSeeRequestContent로 거른다).
 */
export function shopVisibleCustomer(r: {
  shareContact: boolean;
  consumer: {
    name: string | null;
    nickname: string | null;
    phone: string;
    withdrawnAt: Date | null;
  };
}): { name: string; phone: string } | null {
  if (!r.shareContact || r.consumer.withdrawnAt) return null;
  const phone = r.consumer.phone.replace(/[^0-9]/g, "");
  if (!/^01[016789]\d{7,8}$/.test(phone)) return null;
  const name = r.consumer.name?.trim() || r.consumer.nickname?.trim() || "손님";
  return { name, phone: formatPhone(phone) };
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

/** 일반 전화·휴대폰(0으로 시작)과 가게 대표번호(1588·1644 같은 8자리) */
const PHONE_RE = /^(0\d{1,2}-?\d{3,4}-?\d{4}|1[5-9]\d{2}-?\d{4})$/;

/** 누르면 열 주소로 받는 곳(남의 사이트로 보내는 주소는 받지 않는다) */
const CONTACT_HOSTS: Partial<Record<QuoteContactType, string[]>> = {
  KAKAO: ["kakao.com"],
  NAVER: ["naver.com", "naver.me"],
};

function toHttpsUrl(raw: string, hosts: string[]): string | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * 손님이 연락할 곳을 저장할 모양으로(같은 종류는 하나, 앞뒤 공백 정리).
 * 카카오톡 채널은 kakao.com, 네이버 톡톡은 naver.com·naver.me 주소(https 붙임), 인스타그램은 아이디(@·주소에서 뽑음), 전화는 번호.
 * 잘못된 값이 있으면 null
 */
export function normalizeContacts(input: { type: string; value: string }[]): QuoteContact[] | null {
  const seen = new Set<string>();
  const out: QuoteContact[] = [];
  for (const raw of input) {
    if (!QUOTE_CONTACT_TYPES.includes(raw.type as QuoteContactType)) return null;
    const type = raw.type as QuoteContactType;
    if (seen.has(type)) return null;
    seen.add(type);
    const value = (raw.value ?? "").trim();
    if (!value || value.length > QUOTE_LIMITS.CONTACT_VALUE_MAX_LENGTH) return null;
    if (type === "PHONE") {
      const phone = value.replace(/\s/g, "");
      if (!PHONE_RE.test(phone)) return null;
      out.push({ type, value: phone });
    } else if (type === "INSTAGRAM") {
      const fromUrl = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i)?.[1];
      const handle = (fromUrl ?? value).replace(/^@/, "");
      if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
      out.push({ type, value: handle });
    } else {
      const url = toHttpsUrl(value, CONTACT_HOSTS[type] ?? []);
      if (!url) return null;
      out.push({ type, value: url });
    }
  }
  return out;
}
