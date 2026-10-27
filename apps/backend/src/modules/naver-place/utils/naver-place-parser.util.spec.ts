import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { extractApolloState, parseNaverPlace } from "./naver-place-parser.util";

// 실제 네이버 플레이스 응답(아네모네시 케이크 연남, 2026-10)에서 필요한 부분만 남긴 HTML
const html = readFileSync(join(__dirname, "__fixtures__/naver-place-anemonesi.html"), "utf-8");

describe("extractApolloState", () => {
  it("HTML에서 APOLLO_STATE JSON을 꺼낸다 (뒤따르는 스크립트의 `};`에 영향받지 않음)", () => {
    const state = extractApolloState(html);
    expect(state?.ROOT_QUERY).toBeDefined();
    expect(state?.["PlaceDetailBase:1855763938"]?.name).toBe("아네모네시 케이크 연남");
  });

  it("문자열 안의 중괄호는 무시한다", () => {
    const state = extractApolloState('window.__APOLLO_STATE__ = {"a":"}{\\"","b":{"c":1}};');
    expect(state).toEqual({ a: '}{"', b: { c: 1 } });
  });

  it("마커가 없거나 JSON이 깨졌으면 null", () => {
    expect(extractApolloState("<html></html>")).toBeNull();
    expect(extractApolloState("window.__APOLLO_STATE__ = {")).toBeNull();
  });
});

describe("parseNaverPlace", () => {
  const state = extractApolloState(html)!;
  const info = parseNaverPlace(state, "1855763938")!;

  it("기본 정보", () => {
    expect(info).toMatchObject({
      placeId: "1855763938",
      placeUrl: "https://map.naver.com/p/entry/place/1855763938",
      name: "아네모네시 케이크 연남",
      category: "카페,디저트",
      roadAddress: "서울 마포구 동교로 212-22 1층",
      address: "서울 마포구 동교동 153-23",
      latitude: 37.5592408,
      longitude: 126.9243575,
      phone: "0507-1425-1250",
      isVirtualPhone: true,
    });
    expect(info.directions).toContain("로맨틱무브");
    expect(info.description).toContain("2019년 설립");
    expect(info.keywords).toContain("제작케이크");
    expect(info.conveniences).toContain("포장");
    expect(info.parking).toContain("유료주차장");
  });

  it("요일별 영업시간", () => {
    const byDay = Object.fromEntries(info.businessHours.days.map((d) => [d.day, d]));
    expect(byDay["화"]).toMatchObject({ open: null, close: null });
    expect(byDay["화"].description).toContain("정기휴무");
    expect(byDay["목"]).toMatchObject({ open: "14:00", close: "19:00" });
    expect(byDay["금"]).toMatchObject({ open: "11:00", close: "19:00" });
    expect(info.businessHours.freeText).toContain("사전예약제");
  });

  it("링크·메뉴·사진·리뷰", () => {
    expect(info.links.instagram).toBe("http://instagram.com/anemonesi");
    expect(info.links.others.map((l) => l.type)).toEqual(["블로그", "홈페이지"]);

    expect(info.menus).toHaveLength(5);
    expect(info.menus[0]).toMatchObject({ name: expect.any(String) });
    expect(info.menus.some((m) => m.price === "15,000원")).toBe(true);
    expect(info.menus.some((m) => m.isRecommended)).toBe(true);
    expect(info.menuImageUrls).toHaveLength(1);

    // 영상은 제외하고 사진만 담는다
    expect(info.photos.urls).toHaveLength(2);
    expect(info.photos.total).toBe(218);

    expect(info.reviews).toMatchObject({
      visitorCount: 719,
      visitorRating: 4.93,
      blogCafeCount: 213,
    });
    expect(info.reviews.keywords[0]).toEqual({ label: "디저트가 맛있어요", count: 630 });
    expect(info.naverBookingUrl).toContain("booking.naver.com");
  });

  it("다른 플레이스 ID로 찾으면 null", () => {
    expect(parseNaverPlace(state, "1")).toBeNull();
  });
});
