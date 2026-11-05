import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { extractApolloState, parseNaverPlace } from "./naver-place-parser.util";

// 파서가 읽는 구조만 따라 만든 가짜 네이버 플레이스 페이지 (실제 매장 정보가 아님)
const html = readFileSync(join(__dirname, "__fixtures__/naver-place-sample.html"), "utf-8");
const PLACE_ID = "1234567890";

describe("extractApolloState", () => {
  it("HTML에서 APOLLO_STATE JSON을 꺼낸다 (뒤따르는 스크립트의 `};`에 영향받지 않음)", () => {
    const state = extractApolloState(html);
    expect(state?.ROOT_QUERY).toBeDefined();
    expect(state?.[`PlaceDetailBase:${PLACE_ID}`]?.name).toBe("피케이크 샘플 공방");
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
  const info = parseNaverPlace(state, PLACE_ID)!;

  it("기본 정보", () => {
    expect(info).toMatchObject({
      placeId: PLACE_ID,
      placeUrl: `https://map.naver.com/p/entry/place/${PLACE_ID}`,
      name: "피케이크 샘플 공방",
      category: "카페,디저트",
      roadAddress: "서울 마포구 샘플로 1 1층",
      address: "서울 마포구 샘플동 1-1",
      latitude: 37.55,
      longitude: 126.9,
      phone: "0507-1234-5678",
      isVirtualPhone: true,
    });
    expect(info.directions).toContain("샘플역");
    expect(info.description).toContain("2020년");
    expect(info.keywords).toContain("제작케이크");
    expect(info.conveniences).toContain("포장");
    expect(info.parking).toContain("공영주차장");
  });

  it("요일별 영업시간", () => {
    const byDay = Object.fromEntries(info.businessHours.days.map((d) => [d.day, d]));
    expect(byDay["화"]).toMatchObject({ open: null, close: null });
    expect(byDay["화"].description).toContain("정기휴무");
    expect(byDay["목"]).toMatchObject({
      open: "14:00",
      close: "19:00",
      breakHours: [{ start: "16:00", end: "16:30" }],
    });
    expect(byDay["월"]).toMatchObject({ open: "11:00", close: "19:00", lastOrder: "18:30" });
    expect(info.businessHours.freeText).toContain("사전예약제");
  });

  it("링크·메뉴·사진·리뷰", () => {
    expect(info.links.instagram).toBe("http://instagram.com/picake_sample");
    expect(info.links.others.map((l) => l.type)).toEqual(["블로그", "홈페이지"]);

    expect(info.menus).toHaveLength(3);
    expect(info.menus[0]).toMatchObject({
      name: "레터링 케이크 1호",
      price: "35,000원",
      imageUrl: "https://example.com/m1.jpg",
      isRecommended: true,
    });
    expect(info.menus[1]).toMatchObject({ price: "42000", imageUrl: "https://example.com/m2.jpg" });
    expect(info.menus[2]).toMatchObject({ price: null, isRecommended: false });
    expect(info.menuImageUrls).toHaveLength(1);

    // 영상은 제외하고 사진만 담는다
    expect(info.photos.urls).toEqual(["https://example.com/p1.jpg", "https://example.com/p2.jpg"]);
    expect(info.photos.total).toBe(12);

    expect(info.reviews).toMatchObject({
      visitorCount: 10,
      visitorRating: 4.9,
      imageReviewCount: 3,
      blogCafeCount: 3,
    });
    expect(info.reviews.keywords[0]).toEqual({ label: "디저트가 맛있어요", count: 7 });
    expect(info.naverBookingUrl).toContain("booking.naver.com");
    expect(info.bookingBusinessId).toBe("000000");
    expect(info.bookingBusinessTypeId).toBe(6);
  });

  it("다른 플레이스 ID로 찾으면 null", () => {
    expect(parseNaverPlace(state, "1")).toBeNull();
  });
});
