import { describe, expect, it } from "vitest";
import { QuoteRequestStatus } from "@apps/backend/infra/database/prisma/generated/client";

import {
  canChoose,
  isAccepting,
  isReminderDue,
  isStalled,
  linkChatOpenUntil,
  normalizeContacts,
  rechooseUntil,
  formatPhone,
  shopCanSeeRequestContent,
  shopVisibleCustomer,
  targetState,
} from "./quote-policy.util";

const H = 60 * 60 * 1000;
const now = new Date("2026-12-20T03:00:00.000Z");
const req = (over: Partial<Parameters<typeof isAccepting>[0]> = {}) => ({
  status: QuoteRequestStatus.OPEN,
  deadlineAt: new Date(now.getTime() + 48 * H),
  closedAt: null,
  chosenTargetId: null,
  chosenAt: null,
  ...over,
});

describe("견적 ② 규칙(기획 I-46·I-11)", () => {
  it("마감 전이고 아직 안 골랐을 때만 견적을 받는다", () => {
    expect(isAccepting(req(), now)).toBe(true);
    expect(isAccepting(req({ deadlineAt: new Date(now.getTime() - 1) }), now)).toBe(false);
    expect(
      isAccepting(req({ status: QuoteRequestStatus.CONNECTED, chosenTargetId: "t1" }), now),
    ).toBe(false);
  });

  it("고른 뒤 24시간(마감이 먼저면 마감)까지 다시 고를 수 있다", () => {
    const chosen = req({
      status: QuoteRequestStatus.CONNECTED,
      chosenTargetId: "t1",
      chosenAt: new Date(now.getTime() - 2 * H),
    });
    expect(rechooseUntil(chosen)?.getTime()).toBe(now.getTime() + 22 * H);
    expect(canChoose(chosen, "t2", now, false)).toBe(true);
    expect(canChoose(chosen, "t1", now, false)).toBe(false);
    const soon = { ...chosen, deadlineAt: new Date(now.getTime() + H) };
    expect(rechooseUntil(soon)?.getTime()).toBe(now.getTime() + H);
  });

  it("24시간이 지나면 고른 가게가 답이 없을 때만 다시 고를 수 있다", () => {
    const old = req({
      status: QuoteRequestStatus.CONNECTED,
      chosenTargetId: "t1",
      chosenAt: new Date(now.getTime() - 30 * H),
    });
    expect(canChoose(old, "t2", now, false)).toBe(false);
    expect(canChoose(old, "t2", now, true)).toBe(true);
    expect(canChoose({ ...old, status: QuoteRequestStatus.CLOSED }, "t2", now, true)).toBe(false);
  });

  it("손님 마지막 글에 24시간 답이 없으면 막힌 것", () => {
    expect(isStalled(null, now)).toBe(false);
    expect(
      isStalled(
        { lastMessageSender: "SHOP", lastConsumerMessageAt: new Date(now.getTime() - 48 * H) },
        now,
      ),
    ).toBe(false);
    expect(
      isStalled(
        { lastMessageSender: "CONSUMER", lastConsumerMessageAt: new Date(now.getTime() - 23 * H) },
        now,
      ),
    ).toBe(false);
    expect(
      isStalled(
        { lastMessageSender: "CONSUMER", lastConsumerMessageAt: new Date(now.getTime() - 24 * H) },
        now,
      ),
    ).toBe(true);
  });

  it("견적 링크 대화: 고른 가게는 고른 뒤 14일, 아니면 마감 뒤 7일", () => {
    const chosenAt = new Date(now.getTime() - H);
    const r = req({ status: QuoteRequestStatus.CONNECTED, chosenTargetId: "t1", chosenAt });
    expect(linkChatOpenUntil(r, "t1").getTime()).toBe(chosenAt.getTime() + 14 * 24 * H);
    expect(linkChatOpenUntil(r, "t2").getTime()).toBe(r.deadlineAt.getTime() + 7 * 24 * H);
    const closedEarly = req({ status: QuoteRequestStatus.CLOSED, closedAt: now });
    expect(linkChatOpenUntil(closedEarly, "t2").getTime()).toBe(now.getTime() + 7 * 24 * H);
  });

  it("마감 3시간 전 알림톡: 첫 알림톡을 그 전에 보냈고 아직 안 골랐을 때 한 번", () => {
    const deadlineAt = new Date(now.getTime() + 2 * H);
    const base = { ...req({ deadlineAt }), reminderAlimtalkAt: null };
    expect(
      isReminderDue({ ...base, arrivalAlimtalkAt: new Date(now.getTime() - 5 * H) }, now),
    ).toBe(true);
    // 첫 견적이 마감 3시간 안에 와서 이미 알렸으면 다시 보내지 않는다
    expect(
      isReminderDue({ ...base, arrivalAlimtalkAt: new Date(now.getTime() - 0.5 * H) }, now),
    ).toBe(false);
    expect(isReminderDue({ ...base, arrivalAlimtalkAt: null }, now)).toBe(false);
    expect(
      isReminderDue(
        { ...base, arrivalAlimtalkAt: new Date(now.getTime() - 5 * H), reminderAlimtalkAt: now },
        now,
      ),
    ).toBe(false);
  });

  it("가게 쪽 상태: 고름 → 마감 → 보냄 → 어려워요 → 다 모임 → 받는 중", () => {
    const base = { targetId: "t1", declinedAt: null, hasQuote: false, quoteCount: 0, now };
    expect(targetState({ ...base, request: req() })).toBe("OPEN");
    expect(targetState({ ...base, request: req(), quoteCount: 5 })).toBe("FULL");
    expect(targetState({ ...base, request: req(), declinedAt: now })).toBe("DECLINED");
    expect(targetState({ ...base, request: req(), hasQuote: true, quoteCount: 5 })).toBe("SENT");
    expect(
      targetState({
        ...base,
        request: req({ deadlineAt: new Date(now.getTime() - 1) }),
        hasQuote: true,
      }),
    ).toBe("CLOSED");
    const chosen = req({
      status: QuoteRequestStatus.CONNECTED,
      chosenTargetId: "t1",
      chosenAt: now,
    });
    expect(targetState({ ...base, request: chosen })).toBe("CHOSEN_ME");
    expect(targetState({ ...base, targetId: "t2", request: chosen })).toBe("CHOSEN_OTHER");
  });

  it("가게가 손님 글·사진을 보는 때: 끝난 요청(마감·다른 가게를 고름)은 못 보고, 고른 가게는 픽업 24시간 뒤까지", () => {
    const pickup = new Date(now.getTime() + 2 * H);
    expect(shopCanSeeRequestContent("OPEN", pickup, now)).toBe(true);
    expect(shopCanSeeRequestContent("SENT", pickup, now)).toBe(true);
    expect(shopCanSeeRequestContent("DECLINED", pickup, now)).toBe(true);
    expect(shopCanSeeRequestContent("FULL", pickup, now)).toBe(true);
    expect(shopCanSeeRequestContent("CLOSED", pickup, now)).toBe(false);
    expect(shopCanSeeRequestContent("CHOSEN_OTHER", pickup, now)).toBe(false);
    expect(shopCanSeeRequestContent("CHOSEN_ME", pickup, now)).toBe(true);
    const dayAfter = new Date(pickup.getTime() + 24 * H);
    expect(shopCanSeeRequestContent("CHOSEN_ME", pickup, new Date(dayAfter.getTime() - 1))).toBe(
      true,
    );
    expect(shopCanSeeRequestContent("CHOSEN_ME", pickup, dayAfter)).toBe(false);
  });
});

describe("가게 쪽 손님 이름·휴대폰(11-13)", () => {
  const consumer = {
    name: "김민지",
    nickname: "케이크손님",
    phone: "01012345678",
    withdrawnAt: null,
  };
  it("보낼 때 안내를 보고 보낸 요청에만 보인다", () => {
    expect(shopVisibleCustomer({ shareContact: true, consumer })).toEqual({
      name: "김민지",
      phone: "010-1234-5678",
    });
    expect(shopVisibleCustomer({ shareContact: false, consumer })).toBeNull();
  });
  it("이름이 없으면 닉네임, 탈퇴했거나 휴대폰이 아니면 없음", () => {
    expect(
      shopVisibleCustomer({ shareContact: true, consumer: { ...consumer, name: " " } })?.name,
    ).toBe("케이크손님");
    expect(
      shopVisibleCustomer({
        shareContact: true,
        consumer: { ...consumer, withdrawnAt: new Date() },
      }),
    ).toBeNull();
    expect(
      shopVisibleCustomer({
        shareContact: true,
        consumer: { ...consumer, phone: "review-account" },
      }),
    ).toBeNull();
  });
  it("번호 모양", () => {
    expect(formatPhone("0101234567")).toBe("010-123-4567");
    expect(formatPhone("010-1234-5678")).toBe("010-1234-5678");
  });

  it("손님이 연락할 곳: 카톡·네이버는 그 회사 https 주소, 인스타는 아이디, 전화는 번호. 같은 종류 두 번·잘못된 값·남의 주소는 거절", () => {
    expect(
      normalizeContacts([
        { type: "KAKAO", value: "pf.kakao.com/_gureum" },
        { type: "INSTAGRAM", value: "https://www.instagram.com/gureum_bakery/" },
        { type: "NAVER", value: "http://talk.naver.com/ct/w4abcd" },
        { type: "PHONE", value: "02-123-4567" },
      ]),
    ).toEqual([
      { type: "KAKAO", value: "https://pf.kakao.com/_gureum" },
      { type: "INSTAGRAM", value: "gureum_bakery" },
      { type: "NAVER", value: "https://talk.naver.com/ct/w4abcd" },
      { type: "PHONE", value: "02-123-4567" },
    ]);
    expect(normalizeContacts([])).toEqual([]);
    expect(normalizeContacts([{ type: "INSTAGRAM", value: "@cake.lab" }])).toEqual([
      { type: "INSTAGRAM", value: "cake.lab" },
    ]);
    expect(
      normalizeContacts([
        { type: "PHONE", value: "02-123-4567" },
        { type: "PHONE", value: "031-123-4567" },
      ]),
    ).toBeNull();
    expect(normalizeContacts([{ type: "KAKAO", value: "javascript:alert(1)" }])).toBeNull();
    expect(
      normalizeContacts([{ type: "KAKAO", value: "https://kakao.com.evil.example/x" }]),
    ).toBeNull();
    expect(
      normalizeContacts([{ type: "NAVER", value: "https://example.com/naver.com" }]),
    ).toBeNull();
    expect(normalizeContacts([{ type: "PHONE", value: "1234" }])).toBeNull();
    // 가게 대표번호(1588·1644 등)도 받는다
    expect(normalizeContacts([{ type: "PHONE", value: "1588-1234" }])).toEqual([
      { type: "PHONE", value: "1588-1234" },
    ]);
    expect(normalizeContacts([{ type: "PHONE", value: "1234-5678" }])).toBeNull();
    expect(normalizeContacts([{ type: "EMAIL", value: "a@b.c" }])).toBeNull();
  });
});
