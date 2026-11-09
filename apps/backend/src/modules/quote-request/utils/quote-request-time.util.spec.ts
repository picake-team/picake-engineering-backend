import { describe, expect, it } from "vitest";
import {
  isRealYmd,
  kstDateHourToDate,
  resolvePickupWindow,
} from "@apps/backend/modules/quote-request/utils/quote-request-time.util";

/** 한국 시각 문자열 → Date */
const kst = (s: string) => new Date(`${s}+09:00`);

describe("resolvePickupWindow (견적 마감 = 픽업 1시간 전, 지금부터 3시간 안은 못 고름)", () => {
  it("다른 날 아무 때나 → 그날 0시가 픽업 시작, 전날 밤 11시 마감", () => {
    const r = resolvePickupWindow({ pickupDate: "2026-12-24" }, kst("2026-12-20T10:00:00"));
    expect(r).toEqual({
      ok: true,
      pickupStartAt: kst("2026-12-24T00:00:00"),
      deadlineAt: kst("2026-12-23T23:00:00"),
    });
  });

  it("시간을 고르면 그 '부터' 시각이 픽업 시작", () => {
    const r = resolvePickupWindow(
      { pickupDate: "2026-12-24", pickupHourFrom: 14, pickupHourTo: 17 },
      kst("2026-12-20T10:00:00"),
    );
    expect(r).toEqual({
      ok: true,
      pickupStartAt: kst("2026-12-24T14:00:00"),
      deadlineAt: kst("2026-12-24T13:00:00"),
    });
  });

  it("오늘 오후 4시에 오늘 아무 때나 → 오후 7시 이후로 보고 오후 6시 마감(SC-14 예시)", () => {
    const r = resolvePickupWindow({ pickupDate: "2026-11-09" }, kst("2026-11-09T16:00:00"));
    expect(r).toEqual({
      ok: true,
      pickupStartAt: kst("2026-11-09T19:00:00"),
      deadlineAt: kst("2026-11-09T18:00:00"),
    });
  });

  it("오후 4시 20분이면 정시로 올려 오후 8시 이후", () => {
    const r = resolvePickupWindow({ pickupDate: "2026-11-09" }, kst("2026-11-09T16:20:00"));
    expect(r.ok && r.pickupStartAt).toEqual(kst("2026-11-09T20:00:00"));
  });

  it("지금부터 3시간 안의 시각은 고를 수 없다", () => {
    const now = kst("2026-11-09T16:20:00");
    expect(
      resolvePickupWindow({ pickupDate: "2026-11-09", pickupHourFrom: 19, pickupHourTo: 20 }, now),
    ).toEqual({
      ok: false,
      error: "TOO_SOON",
    });
    expect(
      resolvePickupWindow({ pickupDate: "2026-11-09", pickupHourFrom: 20, pickupHourTo: 21 }, now)
        .ok,
    ).toBe(true);
  });

  it("밤 11시에 내일 새벽 1시는 막는다", () => {
    const r = resolvePickupWindow(
      { pickupDate: "2026-11-10", pickupHourFrom: 1, pickupHourTo: 3 },
      kst("2026-11-09T23:00:00"),
    );
    expect(r).toEqual({ ok: false, error: "TOO_SOON" });
  });

  it("오늘 저녁 9시면 오늘 아무 때나도 고를 수 없다(3시간 뒤가 내일)", () => {
    const r = resolvePickupWindow({ pickupDate: "2026-11-09" }, kst("2026-11-09T21:00:00"));
    expect(r).toEqual({ ok: false, error: "TOO_SOON" });
  });

  it("지난 날짜·없는 날짜·1년 넘는 날짜", () => {
    const now = kst("2026-11-09T10:00:00");
    expect(resolvePickupWindow({ pickupDate: "2026-11-08" }, now)).toEqual({
      ok: false,
      error: "PAST_DATE",
    });
    expect(resolvePickupWindow({ pickupDate: "2026-02-30" }, now)).toEqual({
      ok: false,
      error: "INVALID_DATE",
    });
    expect(resolvePickupWindow({ pickupDate: "2027-12-01" }, now)).toEqual({
      ok: false,
      error: "TOO_FAR",
    });
  });

  it("시간은 '부터'·'까지'를 함께, 부터 < 까지 ≤ 24", () => {
    const now = kst("2026-11-09T10:00:00");
    const bad = [
      { pickupHourFrom: 14 },
      { pickupHourFrom: 17, pickupHourTo: 14 },
      { pickupHourFrom: 14, pickupHourTo: 25 },
      { pickupHourFrom: 14, pickupHourTo: 14 },
    ];
    for (const hours of bad) {
      expect(resolvePickupWindow({ pickupDate: "2026-12-24", ...hours }, now)).toEqual({
        ok: false,
        error: "INVALID_HOURS",
      });
    }
    expect(
      resolvePickupWindow({ pickupDate: "2026-12-24", pickupHourFrom: 22, pickupHourTo: 24 }, now)
        .ok,
    ).toBe(true);
  });
});

describe("날짜 도우미", () => {
  it("isRealYmd", () => {
    expect(isRealYmd("2026-12-24")).toBe(true);
    expect(isRealYmd("2026-2-4")).toBe(false);
    expect(isRealYmd("2026-13-01")).toBe(false);
  });

  it("kstDateHourToDate", () => {
    expect(kstDateHourToDate("2026-12-24", 0).toISOString()).toBe("2026-12-23T15:00:00.000Z");
  });
});
