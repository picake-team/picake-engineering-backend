import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { NotificationAppSurface } from "@apps/backend/infra/database/prisma/generated/client";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { SellerMorningSummaryService } from "@apps/backend/modules/fcm/services/seller-morning-summary.service";
import type { SellerFcmPushService } from "@apps/backend/modules/fcm/services/seller-fcm-push.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 아침 요약을 실제 Postgres로 확인한다: 보내는 시간대, 그날 픽업 세기(취소·다른 날 제외),
 * 하루 한 번, 스토어별 끄기, 휴대폰 없는 사장님 건너뛰기, 스토어가 여럿일 때 [스토어 이름].
 * 기준 시각: 2026-11-11 08:05 KST (= 2026-11-10T23:05Z)
 */
describe("판매자 앱 아침 요약 (integration)", () => {
  const NOW = new Date("2026-11-10T23:05:00.000Z");
  const kst = (hhmm: string, day = "2026-11-11") => new Date(`${day}T${hhmm}:00.000+09:00`);

  function buildService() {
    const prisma = getTestPrisma();
    const sendToSeller = vi.fn().mockResolvedValue({ deviceCount: 1 });
    const push = { sendToSeller } as unknown as SellerFcmPushService;
    return { prisma, service: new SellerMorningSummaryService(prisma, push), sendToSeller };
  }

  async function sellerWithStore(opts: { withToken?: boolean; storeCount?: number } = {}) {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const stores: Awaited<ReturnType<typeof createTestStore>>[] = [];
    for (let i = 0; i < (opts.storeCount ?? 1); i += 1) {
      // 같은 사장님의 스토어는 사업자번호가 달라야 함(유니크 조건)
      stores.push(
        await createTestStore(prisma, seller.id, {
          name: `테스트 스토어 ${i + 1}`,
          businessNo: `000-00-0000${i}`,
        }),
      );
    }
    if (opts.withToken ?? true) {
      await prisma.sellerFcmToken.create({
        data: { sellerId: seller.id, deviceId: randomUUID(), token: `tok-${randomUUID()}` },
      });
    }
    const consumer = await createTestConsumer(prisma);
    const products: Awaited<ReturnType<typeof createTestProduct>>[] = [];
    for (const store of stores) products.push(await createTestProduct(prisma, store.id));
    const order = (storeIndex: number, pickupDate: Date, orderStatus: OrderStatus) =>
      createTestOrder(
        prisma,
        {
          consumerId: consumer.id,
          productId: products[storeIndex]!.id,
          storeId: stores[storeIndex]!.id,
        },
        { pickupDate, orderStatus },
      );
    return { seller, stores, order };
  }

  it("8시가 지나면 그날 픽업 수와 첫 픽업 시각을 한 번 보내고, 다시 돌려도 또 보내지 않는다", async () => {
    const { service, sendToSeller } = buildService();
    const { seller, stores, order } = await sellerWithStore();
    await order(0, kst("14:00"), OrderStatus.CONFIRMED);
    await order(0, kst("11:00"), OrderStatus.PAYMENT_COMPLETED);
    await order(0, kst("10:00"), OrderStatus.CANCEL_COMPLETED); // 취소는 빼고 셈
    await order(0, kst("09:00", "2026-11-12"), OrderStatus.CONFIRMED); // 다른 날

    await service.runOnce(NOW);
    const calls = sendToSeller.mock.calls.filter(([p]) => p.sellerId === seller.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toMatchObject({
      sellerId: seller.id,
      title: "오늘 픽업 2건",
      body: "첫 픽업 11:00",
      data: {
        type: "SELLER_MORNING_SUMMARY",
        storeId: stores[0]!.id,
        path: `/stores/${stores[0]!.id}`,
      },
    });

    await service.runOnce(new Date(NOW.getTime() + 10 * 60 * 1000));
    expect(sendToSeller.mock.calls.filter(([p]) => p.sellerId === seller.id)).toHaveLength(1);
  });

  it("8시 전, 11시 이후에는 보내지 않는다", async () => {
    const { service, sendToSeller } = buildService();
    const { seller, order } = await sellerWithStore();
    await order(0, kst("15:00"), OrderStatus.CONFIRMED);

    await service.runOnce(new Date("2026-11-10T22:59:00.000Z")); // 07:59 KST
    await service.runOnce(new Date("2026-11-11T02:00:00.000Z")); // 11:00 KST
    expect(sendToSeller.mock.calls.filter(([p]) => p.sellerId === seller.id)).toHaveLength(0);
  });

  it("그날 픽업이 없거나, 끈 스토어거나, 알림 받을 휴대폰이 없으면 보내지 않는다", async () => {
    const { prisma, service, sendToSeller } = buildService();
    const noPickup = await sellerWithStore();
    await noPickup.order(0, kst("13:00", "2026-11-12"), OrderStatus.CONFIRMED);

    const turnedOff = await sellerWithStore();
    await turnedOff.order(0, kst("13:00"), OrderStatus.CONFIRMED);
    await prisma.userNotificationPreference.create({
      data: {
        sellerId: turnedOff.seller.id,
        storeId: turnedOff.stores[0]!.id,
        appSurface: NotificationAppSurface.SELLER_WEB,
        morningSummaryEnabled: false,
      },
    });

    const noPhone = await sellerWithStore({ withToken: false });
    await noPhone.order(0, kst("13:00"), OrderStatus.CONFIRMED);

    await service.runOnce(NOW);
    const sellerIds = sendToSeller.mock.calls.map(([p]) => p.sellerId);
    expect(sellerIds).not.toContain(noPickup.seller.id);
    expect(sellerIds).not.toContain(turnedOff.seller.id);
    expect(sellerIds).not.toContain(noPhone.seller.id);
  });

  it("스토어가 둘이면 스토어마다 따로, 제목 앞에 [스토어 이름]", async () => {
    const { service, sendToSeller } = buildService();
    const { seller, stores, order } = await sellerWithStore({ storeCount: 2 });
    await order(0, kst("12:00"), OrderStatus.CONFIRMED);
    await order(1, kst("16:30"), OrderStatus.PICKUP_PENDING);

    await service.runOnce(NOW);
    const titles = sendToSeller.mock.calls
      .filter(([p]) => p.sellerId === seller.id)
      .map(([p]) => p.title)
      .sort();
    expect(titles).toEqual(
      [`[${stores[0]!.name}] 오늘 픽업 1건`, `[${stores[1]!.name}] 오늘 픽업 1건`].sort(),
    );
  });
});
