import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import {
  QuoteCakeSize,
  QuoteRequestStatus,
} from "@apps/backend/infra/database/prisma/generated/client";
import { ChatService } from "@apps/backend/modules/chat/services/chat.service";
import type { ChatNotifyService } from "@apps/backend/modules/chat/services/chat-notify.service";
import type { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import {
  CHAT_ERROR_MESSAGES,
  CHAT_RULES_VERSION,
} from "@apps/backend/modules/chat/constants/chat.constants";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";
import { QuoteRequestReadService } from "@apps/backend/modules/quote-request/services/quote-request-read.service";
import { QuoteJobsService } from "@apps/backend/modules/quote-request/services/quote-jobs.service";
import type { QuoteNotifyService } from "@apps/backend/modules/quote-request/services/quote-notify.service";
import { QUOTE_ERROR_MESSAGES } from "@apps/backend/modules/quote-request/constants/quote.constants";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

const H = 60 * 60 * 1000;

/**
 * 견적 ②(기획 I-46, 운영자 결정 2026-11-12)를 실제 Postgres로 확인한다:
 * 지정한 입점 가게의 판매자 앱 채팅으로 요청서 카드, 사장님 견적, 운영자 가게 추가·견적 링크,
 * 링크 안 대화, 고르기와 다른 가게 쓰기 잠금, 다시 고르기, 마감 배치.
 */
describe("견적 ② (integration)", () => {
  let seq = 0;
  const cid = () => `client-${Date.now()}-${++seq}`;

  async function build() {
    const prisma = getTestPrisma();
    const chatNotify = {
      afterMessage: vi.fn().mockResolvedValue(undefined),
      afterRead: vi.fn().mockResolvedValue(undefined),
      afterQuoteEvent: vi.fn().mockResolvedValue(undefined),
    };
    const chat = new ChatService(
      prisma,
      chatNotify as unknown as ChatNotifyService,
      { notifyChatReport: vi.fn() } as unknown as OpsAlertService,
    );
    const notify = {
      quoteArrived: vi.fn().mockResolvedValue(undefined),
      ops: vi.fn().mockResolvedValue(undefined),
      reminder: vi.fn().mockResolvedValue(undefined),
      closedWithoutQuote: vi.fn().mockResolvedValue(undefined),
    };
    const config = { get: () => "https://picakes.test" } as unknown as ConfigService;
    const quotes = new QuoteService(prisma, config, chat, notify as unknown as QuoteNotifyService);
    const jobs = new QuoteJobsService(prisma, notify as unknown as QuoteNotifyService, quotes);
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, { name: "구름베이커리" });
    const consumer = await createTestConsumer(prisma, { nickname: "케이크손님" });
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    await chat.agreeRules("SELLER", seller.id, CHAT_RULES_VERSION);

    async function createRequest(opts: { deadlineInHours?: number } = {}) {
      const deadlineAt = new Date(Date.now() + (opts.deadlineInHours ?? 48) * H);
      const req = await prisma.quoteRequest.create({
        data: {
          consumerId: consumer.id,
          pickupDate: "2026-12-24",
          pickupStartAt: new Date(deadlineAt.getTime() + H),
          deadlineAt,
          areaName: "연남동",
          distanceKm: 3,
          description: "하늘색 바탕에 곰돌이",
          size: QuoteCakeSize.NO1,
          quantity: 1,
          budgetMin: 30_000,
          budgetMax: 50_000,
          stores: { create: [{ storeId: store.id, name: store.name, sortOrder: 0 }] },
        },
        select: { id: true },
      });
      return req.id;
    }

    return {
      prisma,
      chat,
      chatNotify,
      quotes,
      jobs,
      notify,
      seller,
      store,
      consumer,
      createRequest,
    };
  }

  const quoteInput = (unitPrice: number) => ({
    unitPrice,
    similarity: "EXACT" as const,
    contacts: [{ type: "INSTAGRAM" as const, value: "@gureum_bakery" }],
    memo: "곰돌이는 입체로 올려요",
  });

  it("지정한 입점 가게: 판매자 앱 채팅에 요청서 카드가 가고, 손님 목록에는 가게가 답하기 전까지 숨는다", async () => {
    const t = await build();
    const requestId = await t.createRequest();
    await t.quotes.sendNewRequestToApps(requestId);
    await t.quotes.sendNewRequestToApps(requestId); // 두 번 불러도 카드는 하나

    const sellerList = await t.chat.listForStore(t.seller.id, t.store.id, {});
    expect(sellerList.threads).toHaveLength(1);
    expect(sellerList.threads[0]).toMatchObject({ quoteRequest: true, needsReply: true });
    expect(t.chatNotify.afterQuoteEvent).toHaveBeenCalledTimes(1);
    const room = await t.chat.messagesForStore(
      t.seller.id,
      t.store.id,
      sellerList.threads[0].id,
      {},
    );
    expect(room.messages.map((m) => m.kind)).toEqual(["QUOTE_REQUEST"]);
    expect(room.messages[0].card).toMatchObject({
      type: "QUOTE_REQUEST",
      refId: requestId,
      quoteState: "OPEN",
    });
    expect(room.thread.write.ok).toBe(true);

    expect((await t.chat.listForConsumer(t.consumer.id, {})).threads).toHaveLength(0);

    // 사장님이 앱에서 견적을 보내면 방이 손님 목록에 보이고, 견적 카드는 안 읽음을 만들지 않는다
    const view = await t.quotes.sellerView(t.seller.id, t.store.id, requestId);
    expect(view.state).toBe("OPEN");
    const q = await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, quoteInput(58000));
    expect(q).toMatchObject({ total: 58000, similarityLabel: "거의 똑같이", isPicakeStore: true });
    // 손님이 연락할 곳은 가게 쪽에는 바로 보인다
    expect(q.contacts).toEqual([
      {
        type: "INSTAGRAM",
        label: "인스타그램",
        value: "gureum_bakery",
        href: "https://www.instagram.com/gureum_bakery",
      },
    ]);
    expect(t.notify.quoteArrived).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, edited: false, total: 58000 }),
    );
    const consumerList = await t.chat.listForConsumer(t.consumer.id, {});
    expect(consumerList.threads).toHaveLength(1);
    expect(consumerList.threads[0].unread).toBe(false);
    // 미리보기는 보는 쪽 말투로
    expect(consumerList.threads[0].lastMessagePreview).toBe("견적이 도착했어요");
    const afterQuote = await t.chat.listForStore(t.seller.id, t.store.id, {});
    expect(afterQuote.threads[0]).toMatchObject({ needsReply: false, quoteRequest: false });

    // 손님 화면: 처음 열면 새 견적, 다시 열면 본 견적
    const first = await t.quotes.consumerSection(t.consumer.id, requestId);
    expect(first.quotes[0]).toMatchObject({
      unseen: true,
      canChoose: true,
      storeName: "구름베이커리",
    });
    expect(first.quotes[0].threadId).toBe(consumerList.threads[0].id);
    // 손님에게 연락할 곳은 이 가게를 고르기 전에는 보이지 않는다
    expect(first.quotes[0].contacts).toEqual([]);
    expect((await t.quotes.consumerSection(t.consumer.id, requestId)).quotes[0].unseen).toBe(false);

    // 고치면 "고침"과 고침 알림. 10분 안에 또 고치면 알림은 다시 보내지 않는다
    await t.prisma.quote.updateMany({
      where: { quoteRequestId: requestId },
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });
    const edited = await t.quotes.sellerSubmit(
      t.seller.id,
      t.store.id,
      requestId,
      quoteInput(55000),
    );
    expect(edited.edited).toBe(true);
    expect(t.notify.quoteArrived).toHaveBeenLastCalledWith(
      expect.objectContaining({ edited: true }),
    );
    const calls = t.notify.quoteArrived.mock.calls.length;
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, quoteInput(54000));
    expect(t.notify.quoteArrived.mock.calls.length).toBe(calls);

    // 연락할 곳 칸이 없는 화면이 고치면(contacts 없음) 적어 둔 연락할 곳은 그대로
    const kept = await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, {
      unitPrice: 53000,
      similarity: "EXACT",
    });
    expect(kept.contacts.map((c) => c.value)).toEqual(["gureum_bakery"]);
  });

  it("손님 이름·휴대폰: 보낼 때 안내를 본 요청만 가게 쪽에 보이고, 다른 가게를 고르면 사라진다(11-13)", async () => {
    const t = await build();
    const old = await t.createRequest();
    await t.quotes.sendNewRequestToApps(old);
    // 바뀌기 전에 보낸 요청(안내를 못 봄)은 보이지 않는다
    expect((await t.quotes.sellerView(t.seller.id, t.store.id, old)).customer).toBeNull();

    const requestId = await t.createRequest();
    await t.prisma.quoteRequest.update({ where: { id: requestId }, data: { shareContact: true } });
    await t.quotes.sendNewRequestToApps(requestId);
    const seen = await t.quotes.sellerView(t.seller.id, t.store.id, requestId);
    expect(seen.customer?.name).toBe(t.consumer.name);
    expect(seen.customer?.phone).toMatch(/^010-\d{4}-\d{4}$/);
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, quoteInput(58000));

    const section = await t.quotes.adminAddTarget(requestId, {
      kakaoPlaceId: `kp-${Date.now()}-${++seq}`,
      name: "솜사탕케이크",
    });
    const unentered = section.targets.find((x) => !x.quote && x.state === "OPEN")!;
    const token = (await t.quotes.adminCreateLink(requestId, unentered.targetId)).linkUrl.split(
      "/q/",
    )[1];
    expect((await t.quotes.linkView(token)).customer?.phone).toBe(seen.customer?.phone);

    // 입점 가게를 고르면 고르지 않은 가게(링크)에서는 사라지고, 고른 가게에는 남는다
    const picked = (await t.quotes.consumerSection(t.consumer.id, requestId)).quotes[0];
    await t.quotes.choose(t.consumer.id, requestId, picked.id);
    expect((await t.quotes.linkView(token)).customer).toBeNull();
    expect((await t.quotes.sellerView(t.seller.id, t.store.id, requestId)).customer).not.toBeNull();
  });

  it("운영자 가게 추가·견적 링크 → 링크로 견적, 링크 안 대화, 고르면 다른 가게 쓰기 잠금·다시 고르기", async () => {
    const t = await build();
    const requestId = await t.createRequest();
    await t.quotes.sendNewRequestToApps(requestId);
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, quoteInput(58000));

    const section = await t.quotes.adminAddTarget(requestId, {
      kakaoPlaceId: `kp-${Date.now()}-${++seq}`,
      name: "솜사탕케이크",
    });
    const unentered = section.targets.find((x) => !x.quote && x.state === "OPEN")!;
    await expect(
      t.quotes.adminAddTarget(requestId, { storeId: t.store.id }),
    ).rejects.toBeInstanceOf(ConflictException);

    const { linkUrl } = await t.quotes.adminCreateLink(requestId, unentered.targetId);
    expect(linkUrl).toMatch(/^https:\/\/picakes\.test\/q\/[A-Za-z0-9_-]{32}$/);
    const token = linkUrl.split("/q/")[1];
    expect((await t.quotes.adminCreateLink(requestId, unentered.targetId)).linkUrl).toBe(linkUrl);

    const opened = await t.quotes.linkView(token);
    expect(opened).toMatchObject({
      state: "OPEN",
      showEntryGuide: true,
      chatOpen: false,
      area: "연남동",
    });
    // 잘못된 연락할 곳(남의 주소)은 받지 않는다
    await expect(
      t.quotes.linkSubmit(token, {
        ...quoteInput(52000),
        contacts: [{ type: "KAKAO" as const, value: "https://example.com/kakao" }],
      }),
    ).rejects.toThrow(QUOTE_ERROR_MESSAGES.CONTACT_INVALID);
    await t.quotes.linkSubmit(token, {
      ...quoteInput(52000),
      contacts: [
        { type: "KAKAO" as const, value: "pf.kakao.com/_somsatang" },
        { type: "PHONE" as const, value: "02-123-4567" },
      ],
    });
    const sent = await t.quotes.linkView(token);
    expect(sent).toMatchObject({ state: "SENT", chatOpen: true });
    // 가게가 고칠 때 미리 채움
    expect(sent.prefillContacts.map((c) => c.type)).toEqual(["KAKAO", "PHONE"]);
    expect(t.notify.ops).toHaveBeenCalledWith("QUOTE_ARRIVED", requestId, "솜사탕케이크");

    // 손님이 입점 전 가게에 묻고, 가게는 링크에서 답한다
    const consumerSec = await t.quotes.consumerSection(t.consumer.id, requestId);
    expect(consumerSec.quotes).toHaveLength(2);
    expect(consumerSec.askedCount).toBe(2);
    const unenteredQuote = consumerSec.quotes.find((q) => !q.isPicakeStore)!;
    await t.chat.sendForConsumer(t.consumer.id, unenteredQuote.threadId!, {
      clientId: cid(),
      text: "곰돌이 두 개도 되나요?",
    });
    const linkRoom = await t.quotes.linkMessages(token, {});
    expect(linkRoom?.messages.map((m) => m.kind)).toEqual(["QUOTE", "TEXT"]);
    expect(linkRoom?.thread?.unenteredShop).toBe(true);
    await t.quotes.linkSend(token, { clientId: cid(), text: "네 가능해요" });

    // 입점 가게를 고르면 입점 전 가게 쪽은 잠기고, 손님이 다시 말을 걸면 풀린다
    const picake = consumerSec.quotes.find((q) => q.isPicakeStore)!;
    const chosen = await t.quotes.choose(t.consumer.id, requestId, picake.id);
    expect(chosen.threadId).toBe(picake.threadId);
    const sellerRoom = await t.chat.messagesForStore(t.seller.id, t.store.id, picake.threadId!, {});
    expect(sellerRoom.messages.at(-1)).toMatchObject({ kind: "QUOTE_CHOSEN" });
    expect(t.chatNotify.afterQuoteEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        seller: expect.objectContaining({ title: "손님이 견적을 골랐어요" }),
      }),
    );
    await expect(t.quotes.linkSend(token, { clientId: cid(), text: "혹시..." })).rejects.toThrow(
      CHAT_ERROR_MESSAGES.OTHER_CHOSEN,
    );
    const lockedView = await t.quotes.linkMessages(token, {});
    expect(lockedView?.messages.at(-1)?.card).toMatchObject({
      type: "QUOTE_CHOSEN",
      otherChosen: true,
    });
    // 손님 쪽에는 "다른 가게를 골랐어요" 카드가 보이지 않는다
    const consumerView = await t.chat.messagesForConsumer(
      t.consumer.id,
      unenteredQuote.threadId!,
      {},
    );
    expect(consumerView.messages.some((m) => m.card?.otherChosen)).toBe(false);
    await expect(t.quotes.linkSubmit(token, quoteInput(50000))).rejects.toThrow(
      QUOTE_ERROR_MESSAGES.ALREADY_CHOSEN,
    );

    // 24시간 안에는 다른 견적으로 다시 고를 수 있다 → 입점 전 가게는 운영자 알림
    expect(unenteredQuote.contacts).toEqual([]);
    const again = await t.quotes.choose(t.consumer.id, requestId, unenteredQuote.id);
    expect(again.threadId).toBe(unenteredQuote.threadId);
    // 고른 뒤에는 그 가게가 적은 연락할 곳이 손님에게 보인다(다른 가게 것은 계속 안 보임)
    const afterChoose = await t.quotes.consumerSection(t.consumer.id, requestId);
    expect(afterChoose.quotes.find((q) => q.id === unenteredQuote.id)?.contacts).toEqual([
      {
        type: "KAKAO",
        label: "카카오톡 채널",
        value: "https://pf.kakao.com/_somsatang",
        href: "https://pf.kakao.com/_somsatang",
      },
      { type: "PHONE", label: "전화", value: "02-123-4567", href: "tel:021234567" },
    ]);
    expect(afterChoose.quotes.find((q) => q.isPicakeStore)?.contacts).toEqual([]);
    expect(t.notify.ops).toHaveBeenCalledWith("CHOSEN_UNENTERED", requestId, "솜사탕케이크");
    await t.quotes.linkSend(token, { clientId: cid(), text: "감사합니다! 연락드릴게요" });
    const admin = await t.quotes.adminSection(requestId);
    expect(admin).toMatchObject({ chosenIsUnentered: true, chosenNotifiedAt: null });
    await t.quotes.adminMarkChosenNotified(requestId);
    expect((await t.quotes.adminSection(requestId)).chosenNotifiedAt).not.toBeNull();

    // 주간 회의 숫자: 관리자 목록에 견적이 들어온 길별 수와 고름
    const adminList = await new QuoteRequestReadService(t.prisma).listForAdmin({
      page: 1,
      limit: 50,
    });
    const row = adminList.data.find((x) => x.id === requestId)!;
    expect(row).toMatchObject({
      quoteCount: 2,
      chosen: true,
      // 손님이 넣은 가게만 센다(운영자가 더한 입점 전 가게는 빼고)
      storeCount: 1,
      quoteSources: { LINK: 1, SELLER: 1, ADMIN: 0 },
    });

    // 고른 가게(같은 견적)를 다시 고를 수는 없다
    await expect(
      t.quotes.choose(t.consumer.id, requestId, unenteredQuote.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("같은 손님이 같은 입점 전 가게에 다시 요청하면 새 링크에는 이번 요청이 온 뒤 대화만 보인다", async () => {
    const t = await build();
    const kakaoPlaceId = `kp-again-${Date.now()}-${++seq}`;
    const first = await t.createRequest();
    await t.quotes.adminAddTarget(first, { kakaoPlaceId, name: "솜사탕케이크" });
    const target1 = await t.prisma.quoteRequestStore.findFirstOrThrow({
      where: { quoteRequestId: first, kakaoPlaceId },
    });
    const token1 = (await t.quotes.adminCreateLink(first, target1.id)).linkUrl.split("/q/")[1];
    await t.quotes.linkSubmit(token1, quoteInput(52000));
    const q1 = (await t.quotes.consumerSection(t.consumer.id, first)).quotes.find(
      (q) => !q.isPicakeStore,
    )!;
    await t.chat.sendForConsumer(t.consumer.id, q1.threadId!, {
      clientId: cid(),
      text: "지난 요청",
    });
    expect((await t.quotes.linkMessages(token1, {}))?.messages).toHaveLength(2);

    await new Promise((r) => setTimeout(r, 5));
    const second = await t.createRequest();
    await t.quotes.adminAddTarget(second, { kakaoPlaceId, name: "솜사탕케이크" });
    const target2 = await t.prisma.quoteRequestStore.findFirstOrThrow({
      where: { quoteRequestId: second, kakaoPlaceId },
    });
    const token2 = (await t.quotes.adminCreateLink(second, target2.id)).linkUrl.split("/q/")[1];
    // 같은 방이지만 새 링크에는 지난 요청 대화가 보이지 않는다
    expect((await t.quotes.linkMessages(token2, {}))?.messages ?? []).toHaveLength(0);
    await t.quotes.linkSubmit(token2, quoteInput(48000));
    const room = await t.quotes.linkMessages(token2, {});
    expect(room?.messages.map((m) => m.kind)).toEqual(["QUOTE"]);
    // 손님 채팅방에는 지난 대화까지 그대로
    const consumerRoom = await t.chat.messagesForConsumer(t.consumer.id, q1.threadId!, {});
    expect(consumerRoom.messages.some((m) => m.text === "지난 요청")).toBe(true);
  });

  it("끝난 요청은 가게에 손님 글·사진을 보내지 않는다(처리방침 보유 기간), 고른 가게는 보인다", async () => {
    const t = await build();
    const requestId = await t.createRequest();
    await t.prisma.quoteRequest.update({
      where: { id: requestId },
      data: { photoUrls: ["https://example.com/a.jpg"], requestNote: "딸기 넣어 주세요" },
    });
    await t.quotes.sendNewRequestToApps(requestId);
    expect(await t.quotes.sellerView(t.seller.id, t.store.id, requestId)).toMatchObject({
      contentHidden: false,
      description: "하늘색 바탕에 곰돌이",
      photoUrls: ["https://example.com/a.jpg"],
    });
    // 고르면 고른 가게는 계속 본다
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, quoteInput(40000));
    const q = (await t.quotes.consumerSection(t.consumer.id, requestId)).quotes[0];
    await t.quotes.choose(t.consumer.id, requestId, q.id);
    expect(await t.quotes.sellerView(t.seller.id, t.store.id, requestId)).toMatchObject({
      state: "CHOSEN_ME",
      contentHidden: false,
    });
    // 다른 요청이 닫히면 그 가게에는 손님 글·사진이 가지 않는다
    const closed = await t.createRequest();
    await t.quotes.sendNewRequestToApps(closed);
    await t.prisma.quoteRequest.update({
      where: { id: closed },
      data: { status: QuoteRequestStatus.CLOSED, closedAt: new Date() },
    });
    expect(await t.quotes.sellerView(t.seller.id, t.store.id, closed)).toMatchObject({
      state: "CLOSED",
      contentHidden: true,
      description: null,
      requestNote: null,
      photoUrls: [],
    });
    // 채팅 카드 사진도 가게 쪽에는 주지 않는다
    const room = await t.chat.messagesForStore(t.seller.id, t.store.id, q.threadId!, {});
    expect(room.messages.filter((m) => m.card).every((m) => m.card!.imageUrl === null)).toBe(true);
  });

  it("어려워요로 답한 가게는 그사이 견적이 다 모이면 견적으로 바꿀 수 없다", async () => {
    const t = await build();
    const requestId = await t.createRequest();
    await t.quotes.sendNewRequestToApps(requestId);
    await t.quotes.sellerDecline(t.seller.id, t.store.id, requestId, "FULLY_BOOKED");
    expect(await t.quotes.sellerView(t.seller.id, t.store.id, requestId)).toMatchObject({
      state: "DECLINED",
      canEdit: true,
    });
    for (let i = 0; i < 5; i += 1) {
      const kakaoPlaceId = `kp-full-${Date.now()}-${++seq}`;
      await t.quotes.adminAddTarget(requestId, { kakaoPlaceId, name: `가게${i}` });
      const target = await t.prisma.quoteRequestStore.findFirstOrThrow({
        where: { quoteRequestId: requestId, kakaoPlaceId },
      });
      await t.quotes.adminSubmit(requestId, target.id, quoteInput(40000 + i));
    }
    expect(await t.quotes.sellerView(t.seller.id, t.store.id, requestId)).toMatchObject({
      state: "DECLINED",
      canEdit: false,
    });
  });

  it("어려워요는 손님에게 한 줄로, 보낸 뒤에는 어려워요 대신 고치기", async () => {
    const t = await build();
    const requestId = await t.createRequest();
    await t.quotes.sendNewRequestToApps(requestId);
    await t.quotes.sellerDecline(t.seller.id, t.store.id, requestId, "FULLY_BOOKED");
    const sec = await t.quotes.consumerSection(t.consumer.id, requestId);
    // 이유는 손님에게 주지 않는다
    expect(sec.declined).toEqual([{ targetId: expect.any(String), storeName: "구름베이커리" }]);
    expect((await t.quotes.sellerView(t.seller.id, t.store.id, requestId)).state).toBe("DECLINED");
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, quoteInput(40000));
    expect((await t.quotes.consumerSection(t.consumer.id, requestId)).declined).toHaveLength(0);
    await expect(
      t.quotes.sellerDecline(t.seller.id, t.store.id, requestId, "BUDGET"),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 다른 사장님은 이 요청을 볼 수 없다
    const other = await createTestSeller(t.prisma);
    await expect(t.quotes.sellerView(other.id, t.store.id, requestId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("마감 배치: 견적이 없으면 마감 알림, 마감 3시간 전 알림톡은 한 번", async () => {
    const t = await build();
    const empty = await t.createRequest({ deadlineInHours: -1 });
    const withQuote = await t.createRequest({ deadlineInHours: -1 });
    await t.prisma.quoteRequest.update({
      where: { id: withQuote },
      data: { deadlineAt: new Date(Date.now() + H) },
    });
    await t.quotes.sendNewRequestToApps(withQuote);
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, withQuote, quoteInput(30000));
    await t.prisma.quoteRequest.update({
      where: { id: withQuote },
      data: { arrivalAlimtalkAt: new Date(Date.now() - 10 * H) },
    });

    await t.jobs.runOnce();
    const closed = await t.prisma.quoteRequest.findUniqueOrThrow({ where: { id: empty } });
    expect(closed).toMatchObject({ status: QuoteRequestStatus.CLOSED, closeReason: "EXPIRED" });
    expect(t.notify.closedWithoutQuote).toHaveBeenCalledWith(empty);
    expect(t.notify.reminder).toHaveBeenCalledWith(withQuote);
  });

  it("요청이 끝나면 답하지 않은 요청서 카드 방은 사장님 답할 것에서 빠진다(마감·손님이 닫음)", async () => {
    const t = await build();
    const expired = await t.createRequest();
    await t.quotes.sendNewRequestToApps(expired);
    const before = await t.chat.unreadForStore(t.seller.id, t.store.id);
    // 홈은 "견적 요청" 줄로 세고 "답할 채팅"에서는 뺀다
    expect(before).toMatchObject({ replyNeeded: 1, replyNeededChats: 0, quoteRequests: 1 });
    await t.prisma.quoteRequest.update({
      where: { id: expired },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    await t.jobs.runOnce();
    const after = await t.chat.unreadForStore(t.seller.id, t.store.id);
    expect(after).toMatchObject({ replyNeeded: 0, unreadThreads: 0, quoteRequests: 0 });
    const list = await t.chat.listForStore(t.seller.id, t.store.id, {});
    const room = await t.chat.messagesForStore(t.seller.id, t.store.id, list.threads[0].id, {});
    expect(room.messages[0].card?.quoteState).toBe("CLOSED");
  });

  it("같은 손님의 요청 두 개 중 하나가 끝나도, 남은 요청은 사장님 답할 것에 그대로", async () => {
    const t = await build();
    const first = await t.createRequest();
    const second = await t.createRequest();
    await t.quotes.sendNewRequestToApps(second);
    await t.quotes.sendNewRequestToApps(first);
    expect(await t.chat.unreadForStore(t.seller.id, t.store.id)).toMatchObject({
      replyNeeded: 1,
      quoteRequests: 2,
    });
    // 나중 카드(first)가 끝나도 앞 카드(second)는 아직 답을 기다린다
    await t.prisma.quoteRequest.update({
      where: { id: first },
      data: { status: QuoteRequestStatus.CLOSED, closedAt: new Date() },
    });
    await t.quotes.retireRequestCards(first);
    expect(await t.chat.unreadForStore(t.seller.id, t.store.id)).toMatchObject({
      replyNeeded: 1,
      quoteRequests: 1,
    });
    // 남은 요청까지 끝나면 그때 답할 것에서 빠진다
    await t.prisma.quoteRequest.update({
      where: { id: second },
      data: { status: QuoteRequestStatus.CLOSED, closedAt: new Date() },
    });
    await t.quotes.retireRequestCards(second);
    expect(await t.chat.unreadForStore(t.seller.id, t.store.id)).toMatchObject({
      replyNeeded: 0,
      quoteRequests: 0,
    });
  });

  it("사장님 홈 견적 요청 수: 받은 요청은 세고 견적을 보내면 빠진다", async () => {
    const t = await build();
    const requestId = await t.createRequest();
    await t.quotes.sendNewRequestToApps(requestId);
    expect(await t.chat.unreadForStore(t.seller.id, t.store.id)).toMatchObject({
      quoteRequests: 1,
      replyNeededChats: 0,
    });
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, requestId, quoteInput(58000));
    expect(await t.chat.unreadForStore(t.seller.id, t.store.id)).toMatchObject({
      quoteRequests: 0,
      replyNeeded: 0,
      replyNeededChats: 0,
    });
  });

  it("판매자 앱으로 보낼 대상을 못 읽어도(DB 끊김) 오류를 밖으로 던지지 않는다(기다리지 않고 부르므로)", async () => {
    const { quotes } = await build();
    const prisma = getTestPrisma();
    const spy = vi
      .spyOn(prisma.quoteRequestStore, "findMany")
      .mockRejectedValueOnce(new Error("connection reset"));
    await expect(quotes.sendNewRequestToApps("no-such-request")).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
