import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FcmService } from "@apps/backend/modules/fcm/fcm.service";
import { SellerFcmTokenService } from "@apps/backend/modules/fcm/services/seller-fcm-token.service";
import {
  FCM_ANDROID_CHANNEL_ID,
  FCM_PUSH_TYPE,
  buildSellerOrderPath,
} from "@apps/backend/modules/fcm/types/fcm-push.types";

import { SELLER_TEST_PUSH_COPY, SellerFcmPushService } from "./seller-fcm-push.service";

describe("SellerFcmPushService", () => {
  const tokenServiceMock = {
    getTokensBySellerId: vi.fn(),
    removeInvalidTokens: vi.fn(),
  };
  const fcmServiceMock = {
    isEnabled: true,
    sendToTokens: vi.fn(),
  };

  let service: SellerFcmPushService;

  beforeEach(async () => {
    vi.clearAllMocks();
    fcmServiceMock.isEnabled = true;
    fcmServiceMock.sendToTokens.mockResolvedValue({ invalidTokens: [], successCount: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        SellerFcmPushService,
        { provide: SellerFcmTokenService, useValue: tokenServiceMock },
        { provide: FcmService, useValue: fcmServiceMock },
      ],
    }).compile();

    service = moduleRef.get(SellerFcmPushService);
  });

  it("주문 푸시는 판매자 웹 주문 상세 경로를 data.path로 보낸다", async () => {
    tokenServiceMock.getTokensBySellerId.mockResolvedValue(["token-a"]);

    await service.sendOrderPush({
      sellerId: "seller-1",
      storeId: "store-1",
      orderId: "order-1",
      title: "예약 신청이 들어왔습니다",
      body: "고객이 주문을 신청했습니다.",
    });

    expect(fcmServiceMock.sendToTokens).toHaveBeenCalledWith({
      tokens: ["token-a"],
      title: "예약 신청이 들어왔습니다",
      body: "고객이 주문을 신청했습니다.",
      data: {
        type: FCM_PUSH_TYPE.SELLER_ORDER,
        storeId: "store-1",
        orderId: "order-1",
        path: "/stores/store-1/orders/order-1",
      },
      androidChannelId: FCM_ANDROID_CHANNEL_ID.ORDER_NOTIFICATION,
    });
  });

  it("FCM이 꺼져 있으면 토큰을 조회하지 않고 0을 돌려준다", async () => {
    fcmServiceMock.isEnabled = false;

    await expect(service.sendTestPush("seller-1")).resolves.toEqual({ deviceCount: 0 });
    expect(tokenServiceMock.getTokensBySellerId).not.toHaveBeenCalled();
  });

  it("등록된 기기가 없으면 보내지 않고 0을 돌려준다", async () => {
    tokenServiceMock.getTokensBySellerId.mockResolvedValue([]);

    await expect(service.sendTestPush("seller-1")).resolves.toEqual({ deviceCount: 0 });
    expect(fcmServiceMock.sendToTokens).not.toHaveBeenCalled();
  });

  it("테스트 알림은 무효 토큰을 지우고 FCM이 받아들인 기기 수를 돌려준다", async () => {
    tokenServiceMock.getTokensBySellerId.mockResolvedValue(["ok-1", "ok-2", "dead-1"]);
    fcmServiceMock.sendToTokens.mockResolvedValue({ invalidTokens: ["dead-1"], successCount: 2 });

    await expect(service.sendTestPush("seller-1")).resolves.toEqual({ deviceCount: 2 });
    expect(fcmServiceMock.sendToTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        title: SELLER_TEST_PUSH_COPY.title,
        data: { type: FCM_PUSH_TYPE.SELLER_TEST, path: "/" },
      }),
    );
    expect(tokenServiceMock.removeInvalidTokens).toHaveBeenCalledWith(["dead-1"]);
  });

  it("발송 중 오류가 나도 예외를 던지지 않는다 (주문 처리를 막지 않음)", async () => {
    tokenServiceMock.getTokensBySellerId.mockRejectedValue(new Error("db down"));

    await expect(service.sendTestPush("seller-1")).resolves.toEqual({ deviceCount: 0 });
  });
});

describe("buildSellerOrderPath", () => {
  it("id에 경로 문자가 있으면 인코딩한다", () => {
    expect(buildSellerOrderPath("s/1", "o?2")).toBe("/stores/s%2F1/orders/o%3F2");
  });
});
