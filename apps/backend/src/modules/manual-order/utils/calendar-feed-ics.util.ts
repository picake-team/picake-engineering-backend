import { CALENDAR_FEED } from "@apps/backend/modules/manual-order/constants/manual-order.constants";
import {
  addDaysToYmd,
  kstDateTimeToUtc,
} from "@apps/backend/modules/manual-order/utils/manual-order-date.util";

/** ics에 넣을 일정 하나. 시각이 없으면 하루 일정 */
export interface CalendarFeedEvent {
  uid: string;
  /** YYYY-MM-DD(Asia/Seoul) */
  date: string;
  /** HH:mm(Asia/Seoul). 없으면 하루 일정 */
  time: string | null;
  summary: string;
  description: string | null;
  updatedAt: Date;
}

/**
 * ics 글 값 이스케이프(RFC 5545 3.3.11). 줄바꿈(CRLF·CR·LF)은 \\n으로, 그 밖의 제어 문자는 뺀다
 * (손님이 고른 예약자 이름에 CR을 넣어 `URL:` 같은 줄을 끼워 넣지 못하게, 엄격한 캘린더가 피드를 거부하지 않게)
 */
export function escapeIcsText(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n")
      // 줄바꿈을 바꾼 뒤 남은 제어 문자(탭 빼고)
      .replace(/[^\P{Cc}\t]/gu, "")
  );
}

const encoder = new TextEncoder();

/** 한 줄이 75바이트를 넘으면 접는다(RFC 5545 3.1). 한글이 바이트 중간에서 잘리지 않게 글자 단위로 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // 이어지는 줄은 앞의 공백 1바이트를 뺀 74바이트
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = char;
      bytes = size;
    } else {
      current += char;
      bytes += size;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, "");
}

/** 일정 이름: "2호 초코 리스 · 카톡", 손님 이름을 보이면 "· 한지우"를 붙인다 */
export function buildEventSummary(params: {
  title: string;
  sourceLabel: string;
  customerName: string | null;
  showCustomerName: boolean;
}): string {
  const parts = [params.title, params.sourceLabel];
  if (params.showCustomerName && params.customerName) parts.push(params.customerName);
  return parts.join(" · ");
}

/** 구독용 ics 전체 글 */
export function buildCalendarIcs(params: {
  calendarName: string;
  events: CalendarFeedEvent[];
  now: Date;
}): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Picake//Seller Calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(params.calendarName)}`,
    "X-WR-TIMEZONE:Asia/Seoul",
    `REFRESH-INTERVAL;VALUE=DURATION:PT${CALENDAR_FEED.REFRESH_MINUTES}M`,
    `X-PUBLISHED-TTL:PT${CALENDAR_FEED.REFRESH_MINUTES}M`,
    // 일정이 없어도 구성 요소가 하나는 있게(RFC 5545 3.6). 시각은 모두 UTC로 적어 이 정의에 기대지 않는다
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Seoul",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "TZNAME:KST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const event of params.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${utcStamp(params.now)}`);
    lines.push(`LAST-MODIFIED:${utcStamp(event.updatedAt)}`);
    if (event.time) {
      const start = kstDateTimeToUtc(event.date, event.time);
      const end = new Date(start.getTime() + CALENDAR_FEED.EVENT_MINUTES * 60_000);
      lines.push(`DTSTART:${utcStamp(start)}`);
      lines.push(`DTEND:${utcStamp(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymdCompact(event.date)}`);
      lines.push(`DTEND;VALUE=DATE:${ymdCompact(addDaysToYmd(event.date, 1))}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
