import { describe, expect, it } from "vitest";
import { buildNewQuoteRequestDiscordMessage } from "@apps/backend/modules/quote-request/utils/quote-request-ops-message.util";
import type { QuoteRequestRow } from "@apps/backend/modules/quote-request/utils/quote-request-mapper.util";

const kst = (s: string) => new Date(`${s}+09:00`);

const row: QuoteRequestRow = {
  id: "req_1",
  status: "OPEN",
  closeReason: null,
  closedAt: null,
  pickupDate: "2026-12-24",
  pickupHourFrom: 14,
  pickupHourTo: 17,
  pickupStartAt: kst("2026-12-24T14:00:00"),
  deadlineAt: kst("2026-12-24T13:00:00"),
  areaName: "연남동",
  areaSido: "서울",
  areaLatitude: 37.5,
  areaLongitude: 126.9,
  distanceKm: 3,
  onlyDesignatedStores: false,
  description: "하늘색 곰돌이\n레터링 '생일 축하해'",
  photoUrls: ["https://cdn.example.com/a.jpg"],
  size: "NO1",
  quantity: 1,
  creams: ["FRESH_CREAM"],
  flavorNote: null,
  budgetMin: 30000,
  budgetMax: 50000,
  requestNote: "견과류 알레르기",
  entry: "HOME",
  consentedAt: kst("2026-12-20T10:00:00"),
  createdAt: kst("2026-12-20T10:00:00"),
  stores: [
    {
      id: "s1",
      storeId: null,
      kakaoPlaceId: "123",
      name: "구름베이커리",
      address: null,
      addedBy: "CONSUMER",
      phone: null,
      placeUrl: null,
      latitude: null,
      longitude: null,
    },
  ],
};

describe("새 견적 요청 디스코드 알림", () => {
  it("요약·관리자 링크를 담고, 사진 주소는 넣지 않는다", () => {
    const msg = buildNewQuoteRequestDiscordMessage(row, {
      adminDomain: "https://admin.picakes.com/",
      environmentLabel: null,
    });
    const embed = msg.embeds[0];
    expect(embed.title).toBe("새 견적 요청");
    expect(embed.url).toBe("https://admin.picakes.com/consumer/quote-requests/req_1");
    const fields = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
    expect(fields).toMatchObject({
      픽업: "12월 24일(목) 오후 2시~5시",
      "받을 동네": "연남동 3km 안",
      케이크: "1호 케이크 1개 · 생크림",
      예산: "3만~5만원",
      "견적 마감": "12월 24일(목) 오후 1시",
      "들어온 곳": "홈",
      디자인: "참고 사진 1장 · 설명 있음 · 요청 사항 있음",
      "꼭 물어볼 가게": "구름베이커리(입점 전)",
    });
    expect(JSON.stringify(msg)).not.toContain("cdn.example.com");
    expect(JSON.stringify(msg)).not.toContain("생일 축하해");
    expect(JSON.stringify(msg)).not.toContain("견과류");
  });

  it("staging이면 제목에 환경을 붙이고, 관리자 주소가 없으면 링크를 뺀다", () => {
    const msg = buildNewQuoteRequestDiscordMessage(
      { ...row, stores: [] },
      { adminDomain: null, environmentLabel: "staging" },
    );
    expect(msg.embeds[0].title).toBe("[staging] 새 견적 요청");
    expect(msg.embeds[0].url).toBeUndefined();
    expect(msg.embeds[0].fields.find((f) => f.name === "꼭 물어볼 가게")?.value).toBe(
      "없음(근처 가게를 찾아 물어보기)",
    );
  });
});
