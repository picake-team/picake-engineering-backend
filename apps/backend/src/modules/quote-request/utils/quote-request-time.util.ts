import { QUOTE_REQUEST_LIMITS } from "@apps/backend/modules/quote-request/constants/quote-request.constants";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

export type PickupWindowError =
  | "INVALID_DATE"
  | "PAST_DATE"
  | "TOO_FAR"
  | "INVALID_HOURS"
  | "TOO_SOON";

export type PickupWindow =
  | { ok: true; pickupStartAt: Date; deadlineAt: Date }
  | { ok: false; error: PickupWindowError };

/** 한국 날짜(YYYY-MM-DD)의 h시를 실제 시각(UTC Date)으로 */
export function kstDateHourToDate(ymd: string, hour: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour) - KST_OFFSET_MS);
}

/** YYYY-MM-DD가 실제로 있는 날짜인지(2월 30일 등을 막는다) */
export function isRealYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 정시로 올림(이미 정시면 그대로) */
function ceilToHour(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * 픽업 시작 시각과 견적 마감을 정한다(기획 I-46, SC-14 4·5).
 *
 * - 시간을 고르면 그 "부터" 시각이 픽업 시작이다. 지금부터 3시간 안이면 고를 수 없다.
 * - "아무 때나"면 그날 0시가 픽업 시작이다. 그 시각이 지금부터 3시간 안이면 3시간 뒤(정시로 올림)로 본다.
 *   그 시각이 그날을 넘기면(오늘 저녁 8시 이후) 고를 수 없다.
 * - 견적 마감은 픽업 시작 1시간 전이라, 언제 보내도 견적을 적어도 2시간 받는다.
 */
export function resolvePickupWindow(
  input: { pickupDate: string; pickupHourFrom?: number | null; pickupHourTo?: number | null },
  now: Date,
): PickupWindow {
  const { pickupDate } = input;
  const from = input.pickupHourFrom ?? null;
  const to = input.pickupHourTo ?? null;

  if (!isRealYmd(pickupDate)) return { ok: false, error: "INVALID_DATE" };

  const dayStart = kstDateHourToDate(pickupDate, 0);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  if (dayEnd.getTime() <= now.getTime()) return { ok: false, error: "PAST_DATE" };
  if (dayStart.getTime() > now.getTime() + QUOTE_REQUEST_LIMITS.MAX_DAYS_AHEAD * DAY_MS) {
    return { ok: false, error: "TOO_FAR" };
  }

  if ((from === null) !== (to === null)) return { ok: false, error: "INVALID_HOURS" };
  if (from !== null && to !== null) {
    const hoursOk =
      Number.isInteger(from) &&
      Number.isInteger(to) &&
      from >= 0 &&
      from <= 23 &&
      to > from &&
      to <= 24;
    if (!hoursOk) return { ok: false, error: "INVALID_HOURS" };
  }

  const earliest = ceilToHour(
    new Date(now.getTime() + QUOTE_REQUEST_LIMITS.MIN_LEAD_HOURS * HOUR_MS),
  );

  let pickupStartAt: Date;
  if (from !== null) {
    pickupStartAt = kstDateHourToDate(pickupDate, from);
    if (pickupStartAt.getTime() < earliest.getTime()) return { ok: false, error: "TOO_SOON" };
  } else {
    pickupStartAt = dayStart.getTime() >= earliest.getTime() ? dayStart : earliest;
    if (pickupStartAt.getTime() >= dayEnd.getTime()) return { ok: false, error: "TOO_SOON" };
  }

  const deadlineAt = new Date(
    pickupStartAt.getTime() - QUOTE_REQUEST_LIMITS.DEADLINE_BEFORE_PICKUP_HOURS * HOUR_MS,
  );
  return { ok: true, pickupStartAt, deadlineAt };
}

/** 한국 시각의 날짜·시·요일 */
export function toKstParts(date: Date): {
  month: number;
  day: number;
  hour: number;
  weekday: string;
} {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    hour: kst.getUTCHours(),
    weekday: ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()],
  };
}
