import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";

import { ChatAlimtalkService } from "@apps/backend/modules/chat/services/chat-alimtalk.service";
import { CHAT_ALIMTALK_TEMPLATE_IDS } from "@apps/backend/modules/chat/constants/chat.constants";
import type { SolapiService } from "@apps/backend/modules/solapi/solapi.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 채팅 알림톡(기획 I-11·P-82): 앱 알림이 없으면 10분, 있으면 60분 뒤에도 안 읽었을 때 한 번,
 * 방마다 3시간에 한 번, 밤에는 보내지 않음, 알림 끈 방은 보내지 않음.
 */
describe("채팅 알림톡 (integration)", () => {
  const MIN = 60 * 1000;
  // 한국 낮 12시
  const NOON = new Date("2026-11-13T03:00:00.000Z");

  async function setup(side: "SHOP" | "CONSUMER", minutesAgo = 15) {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const consumer = await createTestConsumer(prisma);
    const shop = await prisma.shop.create({ data: { storeId: store.id, name: store.name } });
    const thread = await prisma.chatThread.create({
      data: {
        consumerId: consumer.id,
        shopId: shop.id,
        lastMessageAt: new Date(NOON.getTime() - minutesAgo * MIN),
        lastMessageSender: side,
        lastMessagePreview: "안녕하세요",
      },
    });
    const sendAlimtalk = vi.fn().mockResolvedValue({ messageId: "m-1" });
    const solapi = { isAlimtalkEnabled: true, sendAlimtalk } as unknown as SolapiService;
    const config = {
      get: (k: string) =>
        k === "PUBLIC_USER_DOMAIN" ? "https://picakes.test" : "https://seller.picakes.test",
    } as unknown as ConfigService;
    const service = new ChatAlimtalkService(prisma, solapi, config);
    const callsFor = () =>
      sendAlimtalk.mock.calls.filter((c) => c[0].variables["#{채팅ID}"] === thread.id);
    return { prisma, seller, store, consumer, thread, service, sendAlimtalk, callsFor };
  }

  it("가게 답을 앱 알림 없는 손님이 10분 넘게 안 읽으면 한 번 보내고, 같은 글로 다시 보내지 않는다", async () => {
    const { service, callsFor, consumer, thread } = await setup("SHOP");
    await service.runOnce(NOON);
    expect(callsFor()).toHaveLength(1);
    const [arg] = callsFor()[0];
    expect(arg.to).toBe(consumer.phone);
    expect(arg.templateId).toBe(CHAT_ALIMTALK_TEMPLATE_IDS.CONSUMER_REPLY);
    expect(arg.variables["#{도메인}"]).toBe("picakes.test");
    expect(arg.variables["#{채팅ID}"]).toBe(thread.id);

    await service.runOnce(new Date(NOON.getTime() + 4 * 60 * MIN));
    expect(callsFor()).toHaveLength(1);
  });

  it("읽었거나·알림 끈 방이거나·밤이면 보내지 않는다", async () => {
    const read = await setup("SHOP");
    await read.prisma.chatThread.update({
      where: { id: read.thread.id },
      data: { consumerReadAt: NOON },
    });
    await read.service.runOnce(NOON);
    expect(read.callsFor()).toHaveLength(0);

    const muted = await setup("SHOP");
    await muted.prisma.chatThread.update({
      where: { id: muted.thread.id },
      data: { consumerMuted: true },
    });
    await muted.service.runOnce(NOON);
    expect(muted.callsFor()).toHaveLength(0);

    const night = await setup("SHOP");
    await night.service.runOnce(new Date("2026-11-13T14:00:00.000Z")); // 밤 11시
    expect(night.callsFor()).toHaveLength(0);
  });

  it("앱 알림을 받을 기기가 있으면 60분까지는 기다린다", async () => {
    const t = await setup("SHOP");
    await t.prisma.consumerFcmToken.create({
      data: {
        consumerId: t.consumer.id,
        token: `tok-${t.thread.id}`,
        deviceId: `dev-${t.thread.id}`,
      } as never,
    });
    await t.service.runOnce(NOON);
    expect(t.callsFor()).toHaveLength(0);
    await t.service.runOnce(new Date(NOON.getTime() + 50 * MIN));
    expect(t.callsFor()).toHaveLength(1);
  });

  it("손님 문의를 사장님이 안 읽으면 사장님 번호로 가게 채팅 주소와 함께 보낸다", async () => {
    const { service, callsFor, seller, store } = await setup("CONSUMER");
    await service.runOnce(NOON);
    expect(callsFor()).toHaveLength(1);
    const [arg] = callsFor()[0];
    expect(arg.to).toBe(seller.phone);
    expect(arg.templateId).toBe(CHAT_ALIMTALK_TEMPLATE_IDS.SELLER_NEW_MESSAGE);
    expect(arg.variables["#{스토어ID}"]).toBe(store.id);
    expect(arg.variables["#{도메인}"]).toBe("seller.picakes.test");
  });
});
