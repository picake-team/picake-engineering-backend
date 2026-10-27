import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  extractApolloState,
  NaverPlaceBusinessDay,
  NaverPlaceInfo,
  parseNaverPlace,
} from "./naver-place-parser.util";
import {
  extractInstagramId,
  mapNaverBusinessHours,
  toStorePrefill,
} from "./naver-place-store-prefill.util";

const html = readFileSync(join(__dirname, "__fixtures__/naver-place-anemonesi.html"), "utf-8");
const anemonesi = parseNaverPlace(extractApolloState(html)!, "1855763938")!;

const day = (
  d: string,
  open: string | null,
  close: string | null,
  extra = {},
): NaverPlaceBusinessDay => ({
  day: d,
  open,
  close,
  endsNextDay: false,
  breakHours: [],
  lastOrder: null,
  description: null,
  ...extra,
});

const withDays = (days: NaverPlaceBusinessDay[]): NaverPlaceInfo => ({
  ...anemonesi,
  businessHours: { ...anemonesi.businessHours, days },
});

describe("toStorePrefill", () => {
  it("아네모네시: 화·수 휴무, 표준 11:00~19:00, 목요일은 경고", () => {
    const { storePrefill, warnings } = toStorePrefill(anemonesi);
    expect(storePrefill).toMatchObject({
      name: "아네모네시 케이크 연남",
      phoneNumber: "0507-1425-1250",
      roadAddress: "서울 마포구 동교로 212-22 1층",
      address: "서울 마포구 동교동 153-23",
      latitude: 37.5592408,
      longitude: 126.9243575,
      instagramId: "anemonesi",
      weeklyClosedWeekdays: [2, 3],
      standardOpenTime: "11:00",
      standardCloseTime: "19:00",
    });
    expect(warnings.some((w) => w.includes("목요일 14:00~19:00"))).toBe(true);
    expect(warnings.some((w) => w.includes("안심번호"))).toBe(true);
  });
});

describe("mapNaverBusinessHours", () => {
  it("영업시간이 없으면 전부 null + 경고", () => {
    const result = mapNaverBusinessHours(withDays([]));
    expect(result).toMatchObject({
      weeklyClosedWeekdays: null,
      standardOpenTime: null,
      standardCloseTime: null,
    });
    expect(result.warnings).toHaveLength(1);
  });

  it("'매일'은 7일 모두 같은 시간", () => {
    const result = mapNaverBusinessHours(withDays([day("매일", "10:00", "20:00")]));
    expect(result).toMatchObject({
      weeklyClosedWeekdays: [],
      standardOpenTime: "10:00",
      standardCloseTime: "20:00",
      warnings: [],
    });
  });

  it("24시간 영업(00:00~24:00)은 하루 전체(00:00~00:00)", () => {
    const result = mapNaverBusinessHours(withDays([day("매일", "00:00", "24:00")]));
    expect(result).toMatchObject({ standardOpenTime: "00:00", standardCloseTime: "00:00" });
  });

  it("30분 단위가 아니면 시간은 비우고 경고", () => {
    const result = mapNaverBusinessHours(withDays([day("매일", "10:15", "20:00")]));
    expect(result.standardOpenTime).toBeNull();
    expect(result.warnings[0]).toContain("10:15");
  });

  it("자정을 넘기는 요일은 건너뛰고 경고", () => {
    const result = mapNaverBusinessHours(
      withDays([
        day("평일", "10:00", "20:00"),
        day("주말", "18:00", "02:00", { endsNextDay: true }),
      ]),
    );
    expect(result.standardOpenTime).toBe("10:00");
    expect(result.weeklyClosedWeekdays).toEqual([]);
    expect(result.warnings.some((w) => w.includes("자정"))).toBe(true);
  });

  it("정보 없는 요일은 휴무로 넣지 않고 경고", () => {
    const result = mapNaverBusinessHours(
      withDays([day("월", "10:00", "20:00"), day("화", null, null)]),
    );
    expect(result.weeklyClosedWeekdays).toEqual([2]);
    expect(result.warnings.some((w) => w.includes("일, 수, 목, 금, 토"))).toBe(true);
  });

  it("브레이크타임이 있으면 경고", () => {
    const result = mapNaverBusinessHours(
      withDays([day("매일", "10:00", "20:00", { breakHours: [{ start: "15:00", end: "16:00" }] })]),
    );
    expect(result.warnings.some((w) => w.includes("브레이크타임"))).toBe(true);
  });
});

describe("extractInstagramId", () => {
  it.each([
    ["http://instagram.com/anemonesi", "anemonesi"],
    ["https://www.instagram.com/lierrecake_?utm_source=qr", "lierrecake_"],
    ["https://www.instagram.com/p/ABC123/", null],
    ["https://linktr.ee/anemonesi", null],
    [null, null],
  ])("%s → %s", (url, expected) => {
    expect(extractInstagramId(url)).toBe(expected);
  });
});
