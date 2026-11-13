import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import { OrderStatus, QuoteCakeSize } from "@apps/backend/infra/database/prisma/generated/client";
import { ChatService } from "@apps/backend/modules/chat/services/chat.service";
import type { ChatNotifyService } from "@apps/backend/modules/chat/services/chat-notify.service";
import type { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import { CHAT_RULES_VERSION } from "@apps/backend/modules/chat/constants/chat.constants";
import { OrderCreateService } from "@apps/backend/modules/order/services/order-create.service";
import type { OrderLifecycleHookService } from "@apps/backend/modules/order/services/order-lifecycle-hook.service";
import { OrderMapperUtil } from "@apps/backend/modules/order/utils/order-mapper.util";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";
import { QuoteReservationService } from "@apps/backend/modules/quote-request/services/quote-reservation.service";
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
 * 견적으로 예약하기(기획 I-01, 운영자 결정 2026-11-13): 입점 가게 견적을 고른 손님이 예약신청을 만들고,
 * 이후는 상품 예약과 같은 주문 흐름. 고른 뒤 예약 전까지 사장님은 견적을 고칠 수 있다.
 */
describe("견적으로 예약하기 (integration)", () => {
  let seq = 0;

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
    const hooks = { afterOrderStatusTransition: vi.fn() };
    const orderCreate = new OrderCreateService(
      prisma,
      hooks as unknown as OrderLifecycleHookService,
    );
    const reservation = new QuoteReservationService(prisma, orderCreate, chat);
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, { name: "구름베이커리" });
    const consumer = await createTestConsumer(prisma, { nickname: "케이크손님" });
    await chat.agreeRules("CONSUMER", consumer.id, CHAT_RULES_VERSION);
    await chat.agreeRules("SELLER", seller.id, CHAT_RULES_VERSION);

    const deadlineAt = new Date(Date.now() + 48 * H);
    const pickupAt = new Date(Date.now() + 72 * H);
    const req = await prisma.quoteRequest.create({
      data: {
        consumerId: consumer.id,
        pickupDate: "2026-12-24",
        pickupStartAt: pickupAt,
        deadlineAt,
        areaName: "연남동",
        distanceKm: 3,
        description: "하늘색 바탕에 곰돌이",
        size: QuoteCakeSize.NO1,
        quantity: 2,
        budgetMin: 30_000,
        budgetMax: 50_000,
        stores: { create: [{ storeId: store.id, name: store.name, sortOrder: 0 }] },
      },
      select: { id: true },
    });
    await quotes.sendNewRequestToApps(req.id);
    const input = (unitPrice: number) => ({
      unitPrice,
      similarity: "SIMILAR" as const,
      memo: "곰돌이는 입체로",
    });
    return {
      prisma,
      chat,
      quotes,
      reservation,
      hooks,
      notify,
      seller,
      store,
      consumer,
      requestId: req.id,
      pickupAt,
      input,
    };
  }

  it("입점 가게 견적을 고르면 예약 전까지 고칠 수 있고, 예약하면 예약신청 주문이 생기고 다시 고르기·고치기가 막힌다", async () => {
    const t = await build();
    await t.quotes.sellerSubmit(t.seller.id, t.store.id, t.requestId, t.input(25_000));
    const picked = (await t.quotes.consumerSection(t.consumer.id, t.requestId)).quotes[0];
    await t.quotes.choose(t.consumer.id, t.requestId, picked.id);

    // 고른 뒤 예약 전: 사장님이 금액을 고칠 수 있다(손님에게 고침 알림)
    expect((await t.quotes.sellerView(t.seller.id, t.store.id, t.requestId)).canEdit).toBe(true);
    await t.prisma.quote.updateMany({
      where: { quoteRequestId: t.requestId },
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });
    const edited = await t.quotes.sellerSubmit(
      t.seller.id,
      t.store.id,
      t.requestId,
      t.input(26_000),
    );
    expect(edited.total).toBe(52_000);
    expect(t.notify.quoteArrived).toHaveBeenLastCalledWith(
      expect.objectContaining({ edited: true }),
    );

    const before = await t.quotes.consumerSection(t.consumer.id, t.requestId);
    expect(before).toMatchObject({ canReserve: true, reservationOrderId: null });

    const { orderId } = await t.reservation.reserve(t.consumer.id, t.requestId, {
      pickupDate: t.pickupAt.toISOString(),
    });
    const order = await t.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: OrderMapperUtil.ORDER_ITEMS_INCLUDE,
    });
    expect(order).toMatchObject({
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
      productId: null,
      storeId: t.store.id,
      totalQuantity: 2,
      totalPrice: 52_000,
      reservationPhone: t.consumer.phone,
    });
    expect(order.productName).toBe("견적 1호 케이크");
    expect(t.hooks.afterOrderStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({ orderId, toStatus: OrderStatus.RESERVATION_REQUESTED }),
    );
    // 주문 응답: 견적 정보가 붙고 후기는 받지 않는다
    const dto = OrderMapperUtil.mapToOrderResponse(order);
    expect(dto.quote).toMatchObject({
      quoteRequestId: t.requestId,
      similarityLabel: "비슷하게",
      memo: "곰돌이는 입체로",
      description: "하늘색 바탕에 곰돌이",
      contentHidden: false,
    });
    await t.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: OrderStatus.PICKUP_COMPLETED },
    });
    const done = await t.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: OrderMapperUtil.ORDER_ITEMS_INCLUDE,
    });
    expect(OrderMapperUtil.mapToOrderResponse(done).myReviewUiStatus).toBe("NOT_AVAILABLE");
    await t.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: OrderStatus.RESERVATION_REQUESTED },
    });

    // 채팅방에 예약 카드, 사장님 "답할 채팅"은 만들지 않음
    const thread = await t.prisma.chatThread.findFirstOrThrow({
      where: { consumerId: t.consumer.id },
      select: {
        id: true,
        lastMessageSender: true,
        messages: { select: { kind: true, refOrderId: true } },
      },
    });
    expect(thread.lastMessageSender).toBe("SYSTEM");
    expect(thread.messages).toContainEqual({ kind: "ORDER", refOrderId: orderId });

    // 같은 견적으로 다시 예약 → 409, 사장님 견적 고치기 막힘, 화면에는 예약 번호
    await expect(
      t.reservation.reserve(t.consumer.id, t.requestId, { pickupDate: t.pickupAt.toISOString() }),
    ).rejects.toBeInstanceOf(ConflictException);
    const seller = await t.quotes.sellerView(t.seller.id, t.store.id, t.requestId);
    expect(seller).toMatchObject({ canEdit: false, orderId });
    await expect(
      t.quotes.sellerSubmit(t.seller.id, t.store.id, t.requestId, t.input(27_000)),
    ).rejects.toBeInstanceOf(BadRequestException);
    const after = await t.quotes.consumerSection(t.consumer.id, t.requestId);
    expect(after).toMatchObject({
      canReserve: false,
      reservationOrderId: orderId,
      rechooseUntil: null,
    });

    // 예약을 취소하면 다시 예약할 수 있다
    await t.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: OrderStatus.CANCEL_COMPLETED },
    });
    expect((await t.quotes.consumerSection(t.consumer.id, t.requestId)).canReserve).toBe(true);
  });

  it("고르지 않은 요청·입점 전 가게 견적은 예약할 수 없다", async () => {
    const t = await build();
    await expect(
      t.reservation.reserve(t.consumer.id, t.requestId, { pickupDate: t.pickupAt.toISOString() }),
    ).rejects.toThrow(QUOTE_ERROR_MESSAGES.RESERVE_NOT_CHOSEN);

    const section = await t.quotes.adminAddTarget(t.requestId, {
      kakaoPlaceId: `kp-${Date.now()}-${++seq}`,
      name: "솜사탕케이크",
    });
    const entered = await t.prisma.quoteRequestStore.findFirstOrThrow({
      where: { quoteRequestId: t.requestId, storeId: t.store.id },
      select: { id: true },
    });
    const unentered = section.targets.find((x) => x.targetId !== entered.id)!;
    const token = (await t.quotes.adminCreateLink(t.requestId, unentered.targetId)).linkUrl.split(
      "/q/",
    )[1];
    await t.quotes.linkSubmit(token, t.input(30_000));
    const q = (await t.quotes.consumerSection(t.consumer.id, t.requestId)).quotes[0];
    await t.quotes.choose(t.consumer.id, t.requestId, q.id);
    expect((await t.quotes.consumerSection(t.consumer.id, t.requestId)).canReserve).toBe(false);
    await expect(
      t.reservation.reserve(t.consumer.id, t.requestId, { pickupDate: t.pickupAt.toISOString() }),
    ).rejects.toThrow(QUOTE_ERROR_MESSAGES.RESERVE_UNENTERED);
  });
});
