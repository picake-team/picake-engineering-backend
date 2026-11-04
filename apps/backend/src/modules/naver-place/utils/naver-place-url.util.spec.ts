import { describe, expect, it } from "vitest";

import { extractNaverPlaceId, extractNaverShortCode } from "./naver-place-url.util";

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
    [
      "https://map.naver.com/?app=Y&pinType=site&appname=com.nhn.android.nmap&appMenu=location&pinId=1234567890&menu=location&version=2",
      "1234567890",
    ],
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

describe("extractNaverShortCode", () => {
  it("naver.me 링크에서만 코드를 꺼낸다", () => {
    expect(extractNaverShortCode("https://naver.me/xAbCdEf")).toBe("xAbCdEf");
    expect(extractNaverShortCode("naver.me/xAbCdEf")).toBe("xAbCdEf");
    expect(extractNaverShortCode("https://map.naver.com/p/entry/place/1234567890")).toBeNull();
  });

  it("다른 호스트나 이상한 코드는 받지 않는다", () => {
    expect(extractNaverShortCode("https://naver.me.evil.example.com/xAbCdEf")).toBeNull();
    expect(extractNaverShortCode("https://evil.example.com/naver.me/xAbCdEf")).toBeNull();
    expect(extractNaverShortCode("https://naver.me/abc%2F..%2Fx")).toBeNull();
    expect(extractNaverShortCode("https://naver.me/")).toBeNull();
  });
});
