import { describe, expect, it } from "vitest";
import {
  buildCalendarIcs,
  buildEventSummary,
  escapeIcsText,
  foldIcsLine,
} from "@apps/backend/modules/manual-order/utils/calendar-feed-ics.util";

describe("escapeIcsText", () => {
  it("역슬래시·세미콜론·쉼표·줄바꿈을 RFC 5545대로", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
});

describe("foldIcsLine", () => {
  it("75바이트를 넘으면 접고, 한글이 바이트 중간에서 잘리지 않는다", () => {
    const line = `SUMMARY:${"가".repeat(40)}`; // 8 + 120바이트
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n ");
    expect(parts.length).toBe(2);
    const encoder = new TextEncoder();
    expect(encoder.encode(parts[0]).length).toBeLessThanOrEqual(75);
    expect(encoder.encode(parts[1]).length).toBeLessThanOrEqual(74);
    expect(parts.join("")).toBe(line);
  });

  it("짧은 줄은 그대로", () => {
    expect(foldIcsLine("BEGIN:VEVENT")).toBe("BEGIN:VEVENT");
  });
});

describe("buildEventSummary", () => {
  it("케이크 · 받은 곳, 손님 이름은 켰을 때만", () => {
    const base = { title: "2호 초코 리스", sourceLabel: "카톡", customerName: "한지우" };
    expect(buildEventSummary({ ...base, showCustomerName: false })).toBe("2호 초코 리스 · 카톡");
    expect(buildEventSummary({ ...base, showCustomerName: true })).toBe(
      "2호 초코 리스 · 카톡 · 한지우",
    );
    expect(buildEventSummary({ ...base, customerName: null, showCustomerName: true })).toBe(
      "2호 초코 리스 · 카톡",
    );
  });
});

describe("buildCalendarIcs", () => {
  const now = new Date("2026-11-17T03:00:00.000Z");
  const ics = buildCalendarIcs({
    calendarName: "픽케이크 보늬케이크",
    now,
    events: [
      {
        uid: "manual-a@picakes.com",
        date: "2026-12-24",
        time: "12:00",
        summary: "2호 초코 리스 · 카톡",
        description: "입금 전",
        updatedAt: now,
      },
      {
        uid: "manual-b@picakes.com",
        date: "2026-12-31",
        time: null,
        summary: "1호 생크림 · 인스타",
        description: null,
        updatedAt: now,
      },
    ],
  });

  it("CRLF로 끝나고 달력 머리·일정 둘", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics).toContain("X-WR-CALNAME:픽케이크 보늬케이크");
  });

  it("시각이 있으면 한국 시간을 UTC로(12:00 KST = 03:00Z, 30분)", () => {
    expect(ics).toContain("DTSTART:20261224T030000Z");
    expect(ics).toContain("DTEND:20261224T033000Z");
    expect(ics).toContain("DESCRIPTION:입금 전");
  });

  it("시각이 없으면 하루 일정(끝은 다음 날, 해를 넘겨도)", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
  });
});
