import { describe, expect, it } from "vitest";
import {
  EMPTY_READ_RESULT,
  buildReadSystemPrompt,
  clipConversation,
  toManualOrderReadResult,
} from "@apps/backend/modules/manual-order/utils/manual-order-read.util";
import { MANUAL_ORDER_READ_LIMITS } from "@apps/backend/modules/manual-order/constants/manual-order.constants";

describe("toManualOrderReadResult", () => {
  const ok = {
    found: true,
    pickupDate: "2026-12-24",
    pickupTime: "12:00",
    cakeName: "  2호   초코 리스 ",
    lettering: "메리 크리스마스 지우야",
    price: 45000,
    paid: true,
    customerName: "한지우",
    source: "KAKAO",
    memo: "초 큰 거 2개, 보냉백",
  };

  it("읽은 값을 다듬어 돌려준다", () => {
    expect(toManualOrderReadResult(ok)).toEqual({ ...ok, cakeName: "2호 초코 리스" });
  });

  it("주문이 아니면(found false) 모두 null", () => {
    expect(toManualOrderReadResult({ ...ok, found: false })).toEqual(EMPTY_READ_RESULT);
    expect(toManualOrderReadResult(null)).toEqual(EMPTY_READ_RESULT);
  });

  it("형식이 틀린 칸은 null(없는 날짜·25시·음수 금액·모르는 받은 곳)", () => {
    const result = toManualOrderReadResult({
      ...ok,
      pickupDate: "2026-02-30",
      pickupTime: "25:00",
      price: -1,
      source: "EMAIL",
      paid: "yes",
    });
    expect(result.pickupDate).toBeNull();
    expect(result.pickupTime).toBeNull();
    expect(result.price).toBeNull();
    expect(result.source).toBeNull();
    expect(result.paid).toBeNull();
    expect(result.cakeName).toBe("2호 초코 리스");
  });

  it("읽은 칸이 하나도 없으면 못 읽은 것과 같다", () => {
    expect(
      toManualOrderReadResult({
        ...EMPTY_READ_RESULT,
        found: true,
        customerName: "한지우",
      }),
    ).toEqual(EMPTY_READ_RESULT);
  });
});

describe("clipConversation", () => {
  it("길면 최근(뒤쪽)만 남긴다", () => {
    const text = `${"가".repeat(MANUAL_ORDER_READ_LIMITS.TEXT_MAX_CHARS)}끝`;
    const clipped = clipConversation(text);
    expect(Array.from(clipped).length).toBe(MANUAL_ORDER_READ_LIMITS.TEXT_MAX_CHARS);
    expect(clipped.endsWith("끝")).toBe(true);
  });

  it("줄바꿈을 \\n으로 맞추고 앞뒤 공백을 지운다", () => {
    expect(clipConversation("  a\r\nb\rc  ")).toBe("a\nb\nc");
  });
});

describe("buildReadSystemPrompt", () => {
  it("오늘 날짜·요일과 가게 이름을 넣는다", () => {
    const prompt = buildReadSystemPrompt({ today: "2026-11-17", storeName: "보늬케이크" });
    expect(prompt).toContain("오늘: 2026-11-17 (화요일");
    expect(prompt).toContain("가게 이름: 보늬케이크");
  });
});
