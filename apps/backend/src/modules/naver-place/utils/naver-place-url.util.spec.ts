import { describe, expect, it } from "vitest";

import { extractNaverPlaceId, isNaverShortUrl } from "./naver-place-url.util";

describe("extractNaverPlaceId", () => {
  it.each([
    ["1234567890", "1234567890"],
    [
      "https://map.naver.com/p/entry/place/1234567890?lng=126.92&lat=37.55&placePath=%2Fhome",
      "1234567890",
    ],
    ["https://map.naver.com/p/search/케이크/place/1234567890?c=15.00", "1234567890"],
    ["https://m.place.naver.com/restaurant/1234567890/home", "1234567890"],
    ["https://pcmap.place.naver.com/place/1234567890", "1234567890"],
    ["m.place.naver.com/restaurant/1234567890", "1234567890"],
    ["https://m.map.naver.com/siteview.naver?code=1234567890", "1234567890"],
  ])("%s → %s", (input, expected) => {
    expect(extractNaverPlaceId(input)).toBe(expected);
  });

  it.each([
    "",
    "아네모네시 케이크 연남",
    "https://search.naver.com/search.naver?query=아네모네시",
    "https://naver.me/xAbCdEf",
    "https://evil.example.com/place/1234567890",
  ])("플레이스 ID를 찾을 수 없으면 null: %s", (input) => {
    expect(extractNaverPlaceId(input)).toBeNull();
  });
});

describe("isNaverShortUrl", () => {
  it("naver.me 링크만 단축 링크로 본다", () => {
    expect(isNaverShortUrl("https://naver.me/xAbCdEf")).toBe(true);
    expect(isNaverShortUrl("naver.me/xAbCdEf")).toBe(true);
    expect(isNaverShortUrl("https://map.naver.com/p/entry/place/1234567890")).toBe(false);
  });
});
