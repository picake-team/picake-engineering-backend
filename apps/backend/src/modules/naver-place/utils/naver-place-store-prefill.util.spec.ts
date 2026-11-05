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

// 파서가 읽는 구조만 따라 만든 가짜 네이버 플레이스 페이지 (실제 매장 정보가 아님)
const html = readFileSync(join(__dirname, "__fixtures__/naver-place-sample.html"), "utf-8");
const sample = parseNaverPlace(extractApolloState(html)!, "1234567890")!;

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
  ...sample,
  businessHours: { ...sample.businessHours, days },
});

describe("toStorePrefill", () => {
  it("이름·소개·연락처·인스타 ID·주소를 채우고, 영업시간은 넣지 않는다", () => {
    const { storePrefill, warnings } = toStorePrefill(sample);
    expect(storePrefill).toEqual({
      name: "피케이크 샘플 공방",
      description: "피케이크 샘플 공방은 2020년 문을 연 주문 제작 레터링 케이크 공방입니다.",
      phoneNumber: "0507-1234-5678",
      instagramId: "picake_sample",
      address: "서울 마포구 샘플동 1-1",
      roadAddress: "서울 마포구 샘플로 1 1층",
      latitude: 37.55,
      longitude: 126.9,
    });
    expect(warnings).toEqual(["네이버 안심번호(0507)예요. 실제 연락처로 바꾸는 걸 권장해요."]);
  });

  it("Picake 이름 규칙에 맞지 않으면 자르지 않고 원문 그대로 두고 경고한다", () => {
    const { storePrefill, warnings } = toStorePrefill({ ...sample, name: "케이크&카페 (연남점)" });
    expect(storePrefill.name).toBe("케이크&카페 (연남점)");
    expect(warnings.some((w) => w.includes("이름을 고쳐 주세요"))).toBe(true);
  });

  it("소개가 2,000자를 넘으면 자르지 않고 경고한다", () => {
    const long = "가".repeat(2001);
    const { storePrefill, warnings } = toStorePrefill({ ...sample, description: long });
    expect(storePrefill.description).toBe(long);
    expect(warnings.some((w) => w.includes("소개를 고쳐 주세요"))).toBe(true);
  });

  it("소개가 2,000자 이하면 경고하지 않는다 (네이버 소개글 한도)", () => {
    const { warnings } = toStorePrefill({ ...sample, description: "가".repeat(2000) });
    expect(warnings.some((w) => w.includes("소개를 고쳐 주세요"))).toBe(false);
  });

  it("연락처 형식이 맞지 않으면 안심번호 대신 형식 경고를 낸다", () => {
    const { warnings } = toStorePrefill({ ...sample, phone: "문의는 DM", isVirtualPhone: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("연락처를 고쳐 주세요");
  });

  it("연락처가 없으면 연락처 경고도 없다", () => {
    const { storePrefill, warnings } = toStorePrefill({
      ...sample,
      phone: null,
      isVirtualPhone: false,
    });
    expect(storePrefill.phoneNumber).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe("mapNaverBusinessHours", () => {
  it("가짜 매장: 화 휴무, 표준 11:00~19:00, 목요일·쉬는 시간은 경고", () => {
    const result = mapNaverBusinessHours(sample);
    expect(result).toMatchObject({
      weeklyClosedWeekdays: [2],
      standardOpenTime: "11:00",
      standardCloseTime: "19:00",
    });
    expect(result.warnings.some((w) => w.includes("목요일 14:00~19:00"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("브레이크타임"))).toBe(true);
  });

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
    ["http://instagram.com/picake_sample", "picake_sample"],
    ["https://www.instagram.com/sample.cake_?utm_source=qr", "sample.cake_"],
    ["https://www.instagram.com/p/ABC123/", null],
    ["https://linktr.ee/picake_sample", null],
    [null, null],
  ])("%s → %s", (url, expected) => {
    expect(extractInstagramId(url)).toBe(expected);
  });
});
