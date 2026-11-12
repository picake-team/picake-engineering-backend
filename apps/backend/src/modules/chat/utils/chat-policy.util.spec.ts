import { describe, expect, it } from "vitest";
import {
  buildPreview,
  decideConsumerWrite,
  decideShopWrite,
  isAlimtalkDue,
  isSeoulNight,
  isUnreadFor,
  maskBlockedWords,
  shouldPushNow,
} from "@apps/backend/modules/chat/utils/chat-policy.util";

/** 서울 시각으로 만든 Date(서울 = UTC+9) */
function seoul(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

const base = {
  shopHasStore: true,
  blockedByConsumer: false,
  blockedByShop: false,
  consumerWithdrawn: false,
  hasActiveOrder: false,
};

describe("decideShopWrite (가게 쓰기 규칙)", () => {
  const now = seoul("2026-11-11T12:00:00");

  it("손님 마지막 글이 30일 안이면 쓸 수 있음", () => {
    expect(
      decideShopWrite({ ...base, now, lastConsumerMessageAt: seoul("2026-10-13T12:00:00") }),
    ).toEqual({ ok: true });
  });

  it("손님 마지막 글이 30일 넘으면 잠김(광고 막기)", () => {
    expect(
      decideShopWrite({ ...base, now, lastConsumerMessageAt: seoul("2026-10-11T11:00:00") }),
    ).toEqual({ ok: false, reason: "LOCKED" });
  });

  it("손님이 한 번도 안 썼어도 픽업 전 예약이 있으면 쓸 수 있음(사장님이 먼저 채팅)", () => {
    expect(
      decideShopWrite({ ...base, now, lastConsumerMessageAt: null, hasActiveOrder: true }),
    ).toEqual({ ok: true });
  });

  it("손님이 안 썼고 예약도 없으면 잠김(가게는 먼저 말 못 함)", () => {
    expect(decideShopWrite({ ...base, now, lastConsumerMessageAt: null })).toEqual({
      ok: false,
      reason: "LOCKED",
    });
  });

  it("차단·손님 탈퇴·가게 떠남은 예약이 있어도 막음", () => {
    const at = seoul("2026-11-11T11:00:00");
    expect(
      decideShopWrite({
        ...base,
        now,
        lastConsumerMessageAt: at,
        hasActiveOrder: true,
        blockedByConsumer: true,
      }),
    ).toEqual({ ok: false, reason: "BLOCKED" });
    expect(
      decideShopWrite({ ...base, now, lastConsumerMessageAt: at, blockedByShop: true }),
    ).toEqual({ ok: false, reason: "BLOCKED" });
    expect(
      decideShopWrite({ ...base, now, lastConsumerMessageAt: at, consumerWithdrawn: true }),
    ).toEqual({ ok: false, reason: "CONSUMER_GONE" });
    expect(
      decideShopWrite({ ...base, now, lastConsumerMessageAt: at, shopHasStore: false }),
    ).toEqual({ ok: false, reason: "SHOP_LEFT" });
  });
});

describe("decideConsumerWrite", () => {
  it("가게가 떠났거나 차단이면 못 씀", () => {
    expect(
      decideConsumerWrite({ shopHasStore: true, blockedByConsumer: false, blockedByShop: false }),
    ).toEqual({ ok: true });
    expect(
      decideConsumerWrite({ shopHasStore: false, blockedByConsumer: false, blockedByShop: false }),
    ).toEqual({ ok: false, reason: "SHOP_LEFT" });
    expect(
      decideConsumerWrite({ shopHasStore: true, blockedByConsumer: false, blockedByShop: true }),
    ).toEqual({ ok: false, reason: "BLOCKED" });
  });
});

describe("maskBlockedWords (거르기)", () => {
  it("욕설을 같은 길이의 ●로 가림", () => {
    expect(maskBlockedWords("아 씨발 진짜")).toBe("아 ●● 진짜");
    expect(maskBlockedWords("FUCK you")).toBe("●●●● you");
  });
  it("평범한 글은 null(원문 그대로)", () => {
    expect(maskBlockedWords("초코 시트로 바꿀 수 있나요?")).toBeNull();
  });
});

describe("buildPreview", () => {
  it("거른 글 앞 40자", () => {
    const long = "가".repeat(50);
    expect(buildPreview({ text: long, imageCount: 0 })).toBe(`${"가".repeat(40)}…`);
    expect(buildPreview({ text: "씨발", maskedText: "●●", imageCount: 0 })).toBe("●●");
  });
  it("사진만이면 '사진을 보냈어요', 카드는 종류별 문구", () => {
    expect(buildPreview({ text: "", imageCount: 2 })).toBe("사진을 보냈어요");
    expect(buildPreview({ imageCount: 0, kind: "ORDER" })).toBe("주문에 대해 문의했어요");
    expect(buildPreview({ imageCount: 0, kind: "PRODUCT" })).toBe("상품에 대해 문의했어요");
  });
});

describe("isSeoulNight", () => {
  it("서울 21시~다음 날 8시 전이 밤", () => {
    expect(isSeoulNight(seoul("2026-11-11T20:59:00"))).toBe(false);
    expect(isSeoulNight(seoul("2026-11-11T21:00:00"))).toBe(true);
    expect(isSeoulNight(seoul("2026-11-12T07:59:00"))).toBe(true);
    expect(isSeoulNight(seoul("2026-11-12T08:00:00"))).toBe(false);
  });
});

describe("shouldPushNow", () => {
  const now = seoul("2026-11-11T12:00:00");
  it("20초 안에 방을 봤으면 보내지 않음", () => {
    expect(
      shouldPushNow({ now, enabled: true, muted: false, seenAt: new Date(now.getTime() - 10_000) }),
    ).toBe(false);
    expect(
      shouldPushNow({ now, enabled: true, muted: false, seenAt: new Date(now.getTime() - 25_000) }),
    ).toBe(true);
  });
  it("알림 끔·방 알림 끔이면 보내지 않음", () => {
    expect(shouldPushNow({ now, enabled: false, muted: false, seenAt: null })).toBe(false);
    expect(shouldPushNow({ now, enabled: true, muted: true, seenAt: null })).toBe(false);
  });
  it("사장님 밤 끄기는 밤에만 막음", () => {
    expect(
      shouldPushNow({ now, enabled: true, muted: false, seenAt: null, quietNight: true }),
    ).toBe(true);
    expect(
      shouldPushNow({
        now: seoul("2026-11-11T22:00:00"),
        enabled: true,
        muted: false,
        seenAt: null,
        quietNight: true,
      }),
    ).toBe(false);
  });
});

describe("isAlimtalkDue", () => {
  const incoming = seoul("2026-11-11T12:00:00");
  const common = {
    enabled: true,
    muted: false,
    lastIncomingAt: incoming,
    readAt: null,
    notifiedAt: null,
  };
  it("앱 알림이 없으면 10분 뒤, 있으면 60분 뒤", () => {
    expect(
      isAlimtalkDue({ ...common, now: seoul("2026-11-11T12:09:00"), hasPushDevice: false }),
    ).toBe(false);
    expect(
      isAlimtalkDue({ ...common, now: seoul("2026-11-11T12:10:00"), hasPushDevice: false }),
    ).toBe(true);
    expect(
      isAlimtalkDue({ ...common, now: seoul("2026-11-11T12:30:00"), hasPushDevice: true }),
    ).toBe(false);
    expect(
      isAlimtalkDue({ ...common, now: seoul("2026-11-11T13:00:00"), hasPushDevice: true }),
    ).toBe(true);
  });
  it("읽었으면·3시간 안에 보냈으면·밤이면 보내지 않음", () => {
    const now = seoul("2026-11-11T13:00:00");
    expect(
      isAlimtalkDue({ ...common, now, hasPushDevice: false, readAt: seoul("2026-11-11T12:05:00") }),
    ).toBe(false);
    expect(
      isAlimtalkDue({
        ...common,
        now,
        hasPushDevice: false,
        notifiedAt: seoul("2026-11-11T11:00:00"),
      }),
    ).toBe(false);
    expect(
      isAlimtalkDue({
        ...common,
        lastIncomingAt: seoul("2026-11-11T21:00:00"),
        now: seoul("2026-11-11T22:00:00"),
        hasPushDevice: false,
      }),
    ).toBe(false);
  });
});

describe("isUnreadFor", () => {
  const t = { lastMessageAt: seoul("2026-11-11T12:00:00"), consumerReadAt: null, shopReadAt: null };
  it("마지막 글이 상대 것이고 그 뒤에 안 읽었으면 안 읽음", () => {
    expect(isUnreadFor("SHOP", { ...t, lastMessageSender: "CONSUMER" })).toBe(true);
    expect(isUnreadFor("CONSUMER", { ...t, lastMessageSender: "CONSUMER" })).toBe(false);
    expect(
      isUnreadFor("SHOP", {
        ...t,
        lastMessageSender: "CONSUMER",
        shopReadAt: seoul("2026-11-11T12:01:00"),
      }),
    ).toBe(false);
  });
});
