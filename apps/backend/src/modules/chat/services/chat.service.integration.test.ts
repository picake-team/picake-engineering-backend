import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { ChatService } from "@apps/backend/modules/chat/services/chat.service";
import { ChatOpenService } from "@apps/backend/modules/chat/services/chat-open.service";
import { ChatAdminService } from "@apps/backend/modules/chat/services/chat-admin.service";
import { ChatCleanupService } from "@apps/backend/modules/chat/services/chat-cleanup.service";
import type { ChatNotifyService } from "@apps/backend/modules/chat/services/chat-notify.service";
import type { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import type { UploadService } from "@apps/backend/modules/upload/upload.service";
import { CHAT_RULES_VERSION } from "@apps/backend/modules/chat/constants/chat.constants";
import { getAllowedUploadUrlPrefixes } from "@apps/backend/modules/upload/utils/upload-url.util";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 채팅(기획 I-11) 1단계를 실제 Postgres로 확인한다:
 * 여는 시각 스위치, 규칙 동의, 첫 글에 방 만들기(한 쌍에 하나), 다시 보내기 한 번만, 카드,
 * 가게 쓰기 규칙(30일·픽업 전 예약), 차단, 거르기, 안 읽음, 신고·가리기, 손님 탈퇴, 가게 떠남.
 */
describe("채팅 (integration)", () => {
  let seq = 0;
  const cid = () => `client-${Date.now()}-${++seq}`;
  const photo = () =>
    `${getAllowedUploadUrlPrefixes()[0] ?? "https://cdn.example.com/"}uploads/chat-${seq}.jpg`;

  async function build(opts: { open?: boolean } = {}) {
    const prisma = getTestPrisma();
    const open = new ChatOpenService(prisma);
    await open.setOpensAt(opts.open === false ? null : new Date(Date.now() - 60_000));
    const afterMessage = vi.fn().mockResolvedValue(undefined);
    const notifyChatReport = vi.fn().mockResolvedValue(undefined);
    const chat = new ChatService(
      prisma,
      open,
      { afterMessage } as unknown as ChatNotifyService,
      { notifyChatReport } as unknown as OpsAlertService,
    );
    const admin = new ChatAdminService(prisma, open);
    const deleteFilesByUrl = vi.fn().mockResolvedValue(0);
    const cleanup = new ChatCleanupService(prisma, {
      deleteFilesByUrl,
    } as unknown as UploadService);
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, { name: "구름베이커리" });
    const consumer = await createTestConsumer(prisma, { nickname: "달콤한_마카롱_1234" });
    return {
      prisma,
      open,
      chat,
      admin,
      cleanup,
      seller,
      store,
      consumer,
      afterMessage,
      notifyChatReport,
      deleteFilesByUrl,
    };
  }

  it("여는 시각 전에는 닫혀 있다(입구 숨김, 보내기 403)", async () => {
    const { chat, consumer, store } = await build({ open: false });
    expect((await chat.status()).open).toBe(false);
    expect((await chat.unreadForConsumer(consumer.id)).open).toBe(false);
    await expect(
      chat.startForConsumer(consumer.id, {
        storeId: store.id,
        clientId: cid(),
        text: "안녕하세요",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("규칙에 동의해야 보낼 수 있고, 첫 글에 방이 생기며 같은 가게는 같은 방", async () => {
    const { chat, prisma, consumer, store, afterMessage } = await build();
    await expect(
      chat.startForConsumer(consumer.id, {
        storeId: store.id,
        clientId: cid(),
        text: "안녕하세요",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.chatThread.count({ where: { consumerId: consumer.id } })).toBe(0);

    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const a = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "초코 시트로 바꿀 수 있나요?",
    });
    const b = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "한 가지 더요",
    });
    expect(b.threadId).toBe(a.threadId);
    expect(await prisma.chatThread.count({ where: { consumerId: consumer.id } })).toBe(1);
    expect(afterMessage).toHaveBeenCalledTimes(2);

    const list = await chat.listForConsumer(consumer.id, {});
    expect(list.threads).toHaveLength(1);
    expect(list.threads[0].title).toBe("구름베이커리");
    expect(list.threads[0].lastMessagePreview).toBe("한 가지 더요");
  });

  it("동시에 첫 글을 두 번 보내도 방은 하나", async () => {
    const { chat, prisma, consumer, store } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const [x, y] = await Promise.all([
      chat.startForConsumer(consumer.id, { storeId: store.id, clientId: cid(), text: "하나" }),
      chat.startForConsumer(consumer.id, { storeId: store.id, clientId: cid(), text: "둘" }),
    ]);
    expect(x.threadId).toBe(y.threadId);
    expect(await prisma.chatThread.count({ where: { consumerId: consumer.id } })).toBe(1);
  });

  it("같은 clientId로 다시 보내면 한 번만 저장(알림도 한 번)", async () => {
    const { chat, prisma, consumer, store, afterMessage } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const id = cid();
    const first = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: id,
      text: "안녕하세요",
    });
    const again = await chat.sendForConsumer(consumer.id, first.threadId, {
      clientId: id,
      text: "안녕하세요",
    });
    expect(again.messages[0].id).toBe(first.messages[0].id);
    expect(await prisma.chatMessage.count({ where: { threadId: first.threadId } })).toBe(1);
    expect(afterMessage).toHaveBeenCalledTimes(1);
  });

  it("상품·주문에서 열면 카드가 글 앞에 한 번만 붙고, 주문 카드는 지금 상태를 보여 준다", async () => {
    const { chat, prisma, consumer, store } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const product = await createTestProduct(prisma, store.id, {
      name: "곰돌이 케이크",
      salePrice: 52000,
    });
    const order = await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      {
        productName: "곰돌이 케이크",
        pickupDate: new Date("2026-12-24T15:00:00+09:00"),
      },
    );
    const r1 = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      productId: product.id,
      clientId: cid(),
      text: "이 상품 문의요",
    });
    expect(r1.messages.map((m) => m.kind)).toEqual(["PRODUCT", "TEXT"]);
    expect(r1.messages[0].card).toMatchObject({
      type: "PRODUCT",
      title: "곰돌이 케이크",
      subtitle: "52,000원",
      available: true,
    });
    const r2 = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      productId: product.id,
      clientId: cid(),
      text: "또 문의",
    });
    expect(r2.messages.map((m) => m.kind)).toEqual(["TEXT"]);

    const r3 = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      orderId: order.id,
      clientId: cid(),
      text: "픽업 시간 바꿀 수 있나요",
    });
    expect(r3.messages[0].card).toMatchObject({
      type: "ORDER",
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
    });
    expect(r3.messages[0].card?.subtitle).toContain("12월 24일");
    await prisma.order.update({
      where: { id: order.id },
      data: { orderStatus: OrderStatus.CONFIRMED },
    });
    const msgs = await chat.messagesForConsumer(consumer.id, r1.threadId, {});
    const orderCard = msgs.messages.find((m) => m.kind === "ORDER");
    expect(orderCard?.card?.orderStatus).toBe(OrderStatus.CONFIRMED);
  });

  it("남의 주문·다른 가게 상품으로는 카드를 못 붙인다", async () => {
    const { chat, prisma, consumer, store, seller } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const other = await createTestConsumer(prisma);
    const otherStore = await createTestStore(prisma, seller.id, {
      name: "다른 가게",
      businessNo: `000-00-${Date.now() % 100000}`,
    });
    const product = await createTestProduct(prisma, otherStore.id);
    const order = await createTestOrder(prisma, {
      consumerId: other.id,
      productId: product.id,
      storeId: store.id,
    });
    await expect(
      chat.startForConsumer(consumer.id, {
        storeId: store.id,
        productId: product.id,
        clientId: cid(),
        text: "x",
      }),
    ).rejects.toThrow();
    await expect(
      chat.startForConsumer(consumer.id, {
        storeId: store.id,
        orderId: order.id,
        clientId: cid(),
        text: "x",
      }),
    ).rejects.toThrow();
  });

  it("가게 쓰기 규칙: 손님이 쓴 뒤 30일 안에만, 넘으면 잠기고 손님이 다시 쓰면 풀림", async () => {
    const { chat, prisma, consumer, store, seller } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    await chat.agreeRules("SELLER", seller.id, CHAT_RULES_VERSION);
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "문의요",
    });
    const sent = await chat.sendForStore(seller.id, store.id, r.threadId, {
      clientId: cid(),
      text: "네 가능해요",
    });
    expect(sent.messages[0].mine).toBe(true);

    await prisma.chatThread.update({
      where: { id: r.threadId },
      data: { lastConsumerMessageAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) },
    });
    await expect(
      chat.sendForStore(seller.id, store.id, r.threadId, {
        clientId: cid(),
        text: "할인 행사 안내",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const detail = await chat.threadForStore(seller.id, store.id, r.threadId);
    expect(detail.write).toEqual({ ok: false, message: "손님이 먼저 말하면 다시 보낼 수 있어요." });

    await chat.sendForConsumer(consumer.id, r.threadId, { clientId: cid(), text: "다시 문의" });
    await expect(
      chat.sendForStore(seller.id, store.id, r.threadId, { clientId: cid(), text: "답해요" }),
    ).resolves.toBeTruthy();
  });

  it("사장님이 먼저: 픽업 전 예약이 있으면 주문 카드와 함께 열 수 있고, 끝난 주문이면 못 연다", async () => {
    const { chat, prisma, consumer, store, seller } = await build();
    await chat.agreeRules("SELLER", seller.id, CHAT_RULES_VERSION);
    const product = await createTestProduct(prisma, store.id);
    const done = await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      {
        orderStatus: OrderStatus.PICKUP_COMPLETED,
      },
    );
    const before = await chat.byOrderForStore(seller.id, store.id, done.id);
    expect(before.threadId).toBeNull();
    expect(before.write.ok).toBe(false);
    await expect(
      chat.startFromOrderForStore(seller.id, store.id, done.id, {
        clientId: cid(),
        text: "안녕하세요",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const active = await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      {
        orderStatus: OrderStatus.CONFIRMED,
        productName: "레터링 케이크",
      },
    );
    const r = await chat.startFromOrderForStore(seller.id, store.id, active.id, {
      clientId: cid(),
      text: "레터링 문구 확인 부탁드려요",
    });
    expect(r.messages.map((m) => m.kind)).toEqual(["ORDER", "TEXT"]);
    const consumerView = await chat.listForConsumer(consumer.id, {});
    expect(consumerView.threads[0].unread).toBe(true);
    expect((await chat.unreadForConsumer(consumer.id)).unreadThreads).toBe(1);
    // 손님이 읽으면 안 읽음이 사라진다
    await chat.messagesForConsumer(consumer.id, r.threadId, { markRead: true });
    expect((await chat.unreadForConsumer(consumer.id)).unreadThreads).toBe(0);
  });

  it("차단하면 상대는 못 보내고, 풀면 다시 된다", async () => {
    const { chat, consumer, store, seller } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    await chat.agreeRules("SELLER", seller.id, CHAT_RULES_VERSION);
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "문의",
    });
    await chat.setConsumerFlag(consumer.id, r.threadId, "block", true);
    await expect(
      chat.sendForStore(seller.id, store.id, r.threadId, { clientId: cid(), text: "답" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await chat.setConsumerFlag(consumer.id, r.threadId, "block", false);
    await chat.setStoreFlag(seller.id, store.id, r.threadId, "block", true);
    await expect(
      chat.sendForConsumer(consumer.id, r.threadId, { clientId: cid(), text: "또" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const shopSide = await chat.threadForStore(seller.id, store.id, r.threadId);
    expect(shopSide.blockedByMe).toBe(true);
  });

  it("욕설은 가려서 보이고, 신고하면 운영자 알림 → 관리자에서 원문 확인·가리기(열람 기록)", async () => {
    const { chat, admin, prisma, consumer, store, seller, notifyChatReport } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "아 씨발 언제 돼요",
    });
    expect(r.messages[0].text).toBe("아 ●● 언제 돼요");
    const shopView = await chat.messagesForStore(seller.id, store.id, r.threadId, {});
    expect(shopView.messages[0].text).toBe("아 ●● 언제 돼요");

    const rep = await chat.reportForStore(seller.id, store.id, r.threadId, {
      reason: "ABUSE",
      messageId: r.messages[0].id,
    });
    expect(notifyChatReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: rep.reportId, reason: "ABUSE", reporter: "SHOP" }),
    );

    const detail = await admin.getReport("admin-1", rep.reportId);
    expect(detail.messages[0].text).toBe("아 씨발 언제 돼요");
    expect(await prisma.chatAccessLog.count({ where: { reportId: rep.reportId } })).toBe(1);

    await admin.resolveReport("admin-1", rep.reportId, { action: "HIDE_MESSAGE" });
    const after = await chat.messagesForConsumer(consumer.id, r.threadId, {});
    expect(after.messages[0]).toMatchObject({ hidden: true, text: null });
    expect(
      (await admin.listReports({ status: "OPEN" })).reports.find((x) => x.id === rep.reportId),
    ).toBeUndefined();
  });

  it("사진은 업로드 주소만, 5장까지", async () => {
    const { chat, consumer, store } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    await expect(
      chat.startForConsumer(consumer.id, {
        storeId: store.id,
        clientId: cid(),
        imageUrls: ["https://evil.example.com/a.jpg"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      imageUrls: [photo()],
    });
    expect(r.messages[0].kind).toBe("IMAGE");
    const list = await chat.listForConsumer(consumer.id, {});
    expect(list.threads[0].lastMessagePreview).toBe("사진을 보냈어요");
  });

  it("손님이 탈퇴하면 글·사진을 지우고, 가게 쪽에는 '탈퇴한 손님'으로 남아 더 못 쓴다", async () => {
    const { chat, cleanup, prisma, consumer, store, seller, deleteFilesByUrl } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    await chat.agreeRules("SELLER", seller.id, CHAT_RULES_VERSION);
    const url = photo();
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "문의",
      imageUrls: [url],
    });
    const res = await cleanup.deleteAllForConsumer(consumer.id);
    expect(res.messages).toBe(1);
    expect(deleteFilesByUrl).toHaveBeenCalledWith([url]);
    await prisma.consumer.update({ where: { id: consumer.id }, data: { withdrawnAt: new Date() } });
    const list = await chat.listForStore(seller.id, store.id, {});
    expect(list.threads[0].title).toBe("탈퇴한 손님");
    await expect(
      chat.sendForStore(seller.id, store.id, r.threadId, { clientId: cid(), text: "답" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("사장님이 탈퇴해 스토어가 지워져도 손님 쪽 대화는 남고, 손님은 더 못 보낸다", async () => {
    const { chat, prisma, consumer, store } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "문의",
    });
    await prisma.store.delete({ where: { id: store.id } });
    const list = await chat.listForConsumer(consumer.id, {});
    expect(list.threads[0]).toMatchObject({ title: "구름베이커리", storeId: null });
    const msgs = await chat.messagesForConsumer(consumer.id, r.threadId, {});
    expect(msgs.messages).toHaveLength(1);
    expect(msgs.thread.write).toEqual({ ok: false, message: "가게가 Picake 채팅을 쓰지 않아요." });
  });

  it("남의 방·남의 스토어 방은 볼 수 없다", async () => {
    const { chat, prisma, consumer, store, seller } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "문의",
    });
    const stranger = await createTestConsumer(prisma);
    await expect(chat.messagesForConsumer(stranger.id, r.threadId, {})).rejects.toThrow();
    const otherSeller = await createTestSeller(prisma);
    await expect(
      chat.messagesForStore(otherSeller.id, store.id, r.threadId, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const otherStore = await createTestStore(prisma, seller.id, {
      name: "2호점",
      businessNo: `000-01-${Date.now() % 100000}`,
    });
    await expect(chat.messagesForStore(seller.id, otherStore.id, r.threadId, {})).rejects.toThrow();
  });

  it("새 글 확인(after)은 그 다음 것만, 위로 더 보기(before)는 앞 것", async () => {
    const { chat, consumer, store, seller } = await build();
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    await chat.agreeRules("SELLER", seller.id, CHAT_RULES_VERSION);
    const r = await chat.startForConsumer(consumer.id, {
      storeId: store.id,
      clientId: cid(),
      text: "1",
    });
    const two = await chat.sendForStore(seller.id, store.id, r.threadId, {
      clientId: cid(),
      text: "2",
    });
    await chat.sendForConsumer(consumer.id, r.threadId, { clientId: cid(), text: "3" });
    const after = await chat.messagesForConsumer(consumer.id, r.threadId, {
      after: two.messages[0].id,
    });
    expect(after.messages.map((m) => m.text)).toEqual(["3"]);
    const before = await chat.messagesForConsumer(consumer.id, r.threadId, {
      before: two.messages[0].id,
    });
    expect(before.messages.map((m) => m.text)).toEqual(["1"]);
    const shopList = await chat.listForStore(seller.id, store.id, { filter: "reply" });
    expect(shopList.threads).toHaveLength(1);
    expect(shopList.threads[0].needsReply).toBe(true);
  });
});
