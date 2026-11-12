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

  it("주문 받는 곳: 카톡·네이버는 https 주소, 인스타는 아이디, 전화는 번호. 같은 종류 두 번·잘못된 값은 거절", () => {
    expect(
      normalizeContacts([
        { type: "KAKAO", value: "pf.kakao.com/_gureum" },
        { type: "INSTAGRAM", value: "https://www.instagram.com/gureum_bakery/" },
        { type: "PHONE", value: "010-1234-5678" },
      ]),
    ).toEqual([
      { type: "KAKAO", value: "https://pf.kakao.com/_gureum" },
      { type: "INSTAGRAM", value: "gureum_bakery" },
      { type: "PHONE", value: "010-1234-5678" },
    ]);
    expect(normalizeContacts([{ type: "INSTAGRAM", value: "@cake.lab" }])).toEqual([
      { type: "INSTAGRAM", value: "cake.lab" },
    ]);
    expect(
      normalizeContacts([
        { type: "PHONE", value: "010-1234-5678" },
        { type: "PHONE", value: "02-123-4567" },
      ]),
    ).toBeNull();
    expect(normalizeContacts([{ type: "KAKAO", value: "javascript:alert(1)" }])).toBeNull();
    expect(normalizeContacts([{ type: "PHONE", value: "1234" }])).toBeNull();
    expect(normalizeContacts([{ type: "EMAIL", value: "a@b.c" }])).toBeNull();
  });
});
