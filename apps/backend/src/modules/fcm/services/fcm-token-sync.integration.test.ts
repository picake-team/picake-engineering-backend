import { describe, expect, it } from "vitest";

import { ConsumerFcmTokenService } from "@apps/backend/modules/fcm/services/consumer-fcm-token.service";
import { SellerFcmTokenService } from "@apps/backend/modules/fcm/services/seller-fcm-token.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import { createTestConsumer, createTestSeller } from "@apps/backend/test/integration/factories";

/**
 * 앱은 처음 등록할 때 같은 휴대폰 토큰을 거의 동시에 두 번 보낼 수 있다
 * (staging 판매자 앱 2026-11-10: 같은 초에 POST 두 번 → 하나가 token 유니크 충돌로 500).
 * 실제 Postgres에서 동시에 보내도 둘 다 성공하고 한 줄만 남는지 확인한다.
 */
describe("휴대폰 알림 토큰 동시 등록 (integration)", () => {
  it("판매자: 같은 기기·토큰을 동시에 여러 번 보내도 모두 성공하고 한 줄만 남는다", async () => {
    const prisma = getTestPrisma();
    const service = new SellerFcmTokenService(prisma);
    const seller = await createTestSeller(prisma);

    for (let round = 0; round < 5; round += 1) {
      const token = `seller-token-${round}`;
      const deviceId = `seller-device-${round}`;
      await expect(
        Promise.all([1, 2, 3].map(() => service.syncToken(seller.id, deviceId, token))),
      ).resolves.toBeDefined();

      const rows = await prisma.sellerFcmToken.findMany({
        where: { sellerId: seller.id, deviceId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token).toBe(token);
    }
  });

  it("손님: 같은 기기·토큰을 동시에 여러 번 보내도 모두 성공하고 한 줄만 남는다", async () => {
    const prisma = getTestPrisma();
    const service = new ConsumerFcmTokenService(prisma);
    const consumer = await createTestConsumer(prisma);

    for (let round = 0; round < 5; round += 1) {
      const token = `consumer-token-${round}`;
      const deviceId = `consumer-device-${round}`;
      await expect(
        Promise.all([1, 2, 3].map(() => service.syncToken(consumer.id, deviceId, token))),
      ).resolves.toBeDefined();

      const rows = await prisma.consumerFcmToken.findMany({
        where: { consumerId: consumer.id, deviceId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token).toBe(token);
    }
  });
});
