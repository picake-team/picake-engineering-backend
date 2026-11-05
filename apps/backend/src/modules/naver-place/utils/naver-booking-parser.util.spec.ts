import { describe, expect, it } from "vitest";
import {
  parseNaverBookingItems,
  parseNaverBookingOptions,
  pickNaverBookingDate,
  pickNaverBookingSlot,
  toNaverImageUrl,
} from "@apps/backend/modules/naver-place/utils/naver-booking-parser.util";

// 네이버 예약 응답 형태를 본뜬 예시 데이터 (실제 매장 데이터 아님)
const itemsResponse = {
  data: {
    bizItems: [
      {
        bizItemId: "1001",
        name: "샘플 생크림 케이크",
        desc: "제철 과일 생크림 케이크입니다.\n미니, 1호, 2호가 있어요.",
        price: 0,
        bizItemSubType: "RESTAURANT_PICKUP",
        isRequiringBookingOption: true,
        isClosedBooking: false,
        isImp: true,
        bookingPrecautionJson: [
          { title: "꼭 확인해 주세요", desc: "3일 전까지 취소 가능" },
          { desc: "" },
        ],
        bizItemResources: [
          { resourceUrl: "https://naverbooking-phinf.pstatic.net/b.jpg", order: 2 },
          { resourceUrl: "https://naverbooking-phinf.pstatic.net/a.jpg", order: 1 },
          { resourceUrl: "https://evil.example.com/x.jpg", order: 3 },
        ],
      },
      { bizItemId: "1002", name: "숨긴 상품", isImp: false },
      { bizItemId: "abc", name: "잘못된 ID" },
      { bizItemId: "1003", name: "  " },
    ],
  },
};

describe("parseNaverBookingItems", () => {
  it("노출 상품만, 사진은 순서대로·네이버 이미지 서버만 남긴다", () => {
    const items = parseNaverBookingItems(itemsResponse);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      bizItemId: "1001",
      name: "샘플 생크림 케이크",
      price: 0,
      requiresOption: true,
      isClosed: false,
      precautions: [{ title: "꼭 확인해 주세요", desc: "3일 전까지 취소 가능" }],
    });
    expect(items[0].imageUrls).toEqual([
      "https://naverbooking-phinf.pstatic.net/a.jpg",
      "https://naverbooking-phinf.pstatic.net/b.jpg",
    ]);
  });

  it("형식이 다르면 빈 목록", () => {
    expect(parseNaverBookingItems({})).toEqual([]);
    expect(parseNaverBookingItems({ data: { bizItems: null } })).toEqual([]);
  });
});

describe("toNaverImageUrl", () => {
  it("https + *.pstatic.net만 허용", () => {
    expect(toNaverImageUrl("https://ldb-phinf.pstatic.net/a.jpg")).toBe(
      "https://ldb-phinf.pstatic.net/a.jpg",
    );
    expect(toNaverImageUrl("http://ldb-phinf.pstatic.net/a.jpg")).toBeNull();
    expect(toNaverImageUrl("https://pstatic.net.evil.com/a.jpg")).toBeNull();
    expect(toNaverImageUrl("https://user:pw@ldb-phinf.pstatic.net/a.jpg")).toBeNull();
    expect(toNaverImageUrl("https://ldb-phinf.pstatic.net:8443/a.jpg")).toBeNull();
    expect(toNaverImageUrl("not a url")).toBeNull();
  });
});

describe("pickNaverBookingSlot", () => {
  it("영업·판매하는 가장 이른 시간을 고른다", () => {
    const slot = pickNaverBookingSlot({
      data: {
        hourlySchedule: [
          {
            slotId: "1",
            scheduleId: "2",
            unitStartDateTime: "2026-11-05T11:00:00+09:00",
            isBusinessDay: true,
            isSaleDay: false,
          },
          {
            slotId: "3",
            scheduleId: "4",
            unitStartDateTime: "2026-11-06T13:00:00+09:00",
            isBusinessDay: true,
            isSaleDay: true,
            isUnitBusinessDay: true,
            isUnitSaleDay: true,
          },
        ],
      },
    });
    expect(slot).toEqual({ slotId: "3", scheduleId: "4", startDate: "2026-11-06" });
  });

  it("예약 가능한 시간이 없으면 null", () => {
    expect(pickNaverBookingSlot({ data: { hourlySchedule: [] } })).toBeNull();
    expect(pickNaverBookingSlot({})).toBeNull();
  });
});

describe("parseNaverBookingOptions", () => {
  it("분류·하위 분류 옵션을 한 줄로 펴고 품절을 표시한다", () => {
    const options = parseNaverBookingOptions({
      data: {
        option: [
          {
            name: "카테고리 미지정",
            options: [
              { optionId: "11", name: "보냉백", price: 2000, isSoldOut: false },
              { optionId: "12", name: "샘플 케이크 1호", price: 54000, desc: "지름15cm" },
              { optionId: "12", name: "중복", price: 1 },
            ],
          },
          {
            name: "토핑",
            children: [
              {
                name: "초",
                options: [{ optionId: "21", name: "숫자초", price: 500, isSoldOut: true }],
              },
            ],
          },
        ],
      },
    });
    expect(options.map((o) => [o.optionId, o.categoryName, o.name, o.price, o.isSoldOut])).toEqual([
      ["11", null, "보냉백", 2000, false],
      ["12", null, "샘플 케이크 1호", 54000, false],
      ["21", "초", "숫자초", 500, true],
    ]);
  });
});

describe("pickNaverBookingDate (날짜 단위 예약 방식)", () => {
  it("예약 가능한 가장 이른 날짜를 고른다", () => {
    expect(
      pickNaverBookingDate({
        data: {
          timeSlotAvailabilityDailySummaries: [
            { date: "2026-11-05", hasSlots: false },
            { date: "2026-11-06", hasSlots: true, isHoliday: true },
            { date: "2026-11-08", hasSlots: true, isHoliday: false },
          ],
        },
      }),
    ).toBe("2026-11-08");
  });

  it("없으면 null", () => {
    expect(pickNaverBookingDate({ data: { timeSlotAvailabilityDailySummaries: [] } })).toBeNull();
    expect(pickNaverBookingDate({})).toBeNull();
  });
});

describe("parseNaverBookingOptions 옵션 사진", () => {
  it("옵션 사진은 네이버 이미지 서버 주소만 남긴다", () => {
    const [a, b] = parseNaverBookingOptions({
      data: {
        option: [
          {
            name: "케이크",
            options: [
              { optionId: "1", name: "a", price: 1, titleImageUrl: "https://x.pstatic.net/a.jpg" },
              {
                optionId: "2",
                name: "b",
                price: 1,
                titleImageUrl: "https://evil.example.com/b.jpg",
              },
            ],
          },
        ],
      },
    });
    expect(a.imageUrl).toBe("https://x.pstatic.net/a.jpg");
    expect(b.imageUrl).toBeNull();
  });
});
