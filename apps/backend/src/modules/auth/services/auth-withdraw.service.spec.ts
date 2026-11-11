import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import {
  AUDIENCE,
  AUTH_ERROR_MESSAGES,
  SELLER_REVIEW_ACCOUNT_PHONE_MARKER,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";
import { AuthAppleOauthService } from "@apps/backend/modules/auth/services/auth-apple-oauth.service";

import { AuthWithdrawService } from "./auth-withdraw.service";
import { QuoteRequestCleanupService } from "@apps/backend/modules/quote-request/services/quote-request-cleanup.service";
import { ChatCleanupService } from "@apps/backend/modules/chat/services/chat-cleanup.service";

describe("AuthWithdrawService.withdraw", () => {
  const prismaMock = mockDeep<PrismaService>();
  const authAppleOauthServiceMock = { revokeToken: vi.fn() };
  const quoteCleanupMock = {
    deleteAllForConsumer: vi.fn().mockResolvedValue({ requests: 0, photos: 0 }),
  };
  const chatCleanupMock = {
    deleteAllForConsumer: vi.fn().mockResolvedValue({ messages: 0, photos: 0 }),
  };

  let service: AuthWithdrawService;

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.order.count.mockResolvedValue(0);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthWithdrawService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthAppleOauthService, useValue: authAppleOauthServiceMock },
        { provide: QuoteRequestCleanupService, useValue: quoteCleanupMock },
        { provide: ChatCleanupService, useValue: chatCleanupMock },
      ],
    }).compile();

    service = moduleRef.get(AuthWithdrawService);
  });

  describe("consumer", () => {
    it("탈퇴하면 견적 요청을 지운다(주문과 달리 보관 의무 없음)", async () => {
      prismaMock.consumer.findUnique.mockResolvedValue({
        id: "consumer-1",
        withdrawnAt: null,
        appleRefreshToken: null,
      } as any);

      await service.withdraw(AUDIENCE.CONSUMER, "consumer-1", "탈퇴 사유");

      expect(quoteCleanupMock.deleteAllForConsumer).toHaveBeenCalledWith("consumer-1");
      // 채팅 글·사진도 탈퇴 즉시 지운다(기획 I-11)
      expect(chatCleanupMock.deleteAllForConsumer).toHaveBeenCalledWith("consumer-1");
      expect(prismaMock.consumer.update).toHaveBeenCalled();
    });

    it("진행 중인 주문 때문에 탈퇴를 막으면 견적 요청도 지우지 않는다", async () => {
      prismaMock.consumer.findUnique.mockResolvedValue({
        id: "consumer-1",
        withdrawnAt: null,
        appleRefreshToken: null,
      } as any);
      prismaMock.order.count.mockResolvedValue(1);

      await expect(
        service.withdraw(AUDIENCE.CONSUMER, "consumer-1", "탈퇴 사유"),
      ).rejects.toThrow();
      expect(quoteCleanupMock.deleteAllForConsumer).not.toHaveBeenCalled();
      expect(chatCleanupMock.deleteAllForConsumer).not.toHaveBeenCalled();
    });

    it("계정이 없으면 NotFoundException을 던진다", async () => {
      prismaMock.consumer.findUnique.mockResolvedValue(null);

      await expect(service.withdraw(AUDIENCE.CONSUMER, "consumer-1", "탈퇴 사유")).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.consumer.update).not.toHaveBeenCalled();
    });

    it("이미 탈퇴된 계정이면 다시 익명화하지 않고 NotFoundException을 던진다", async () => {
      prismaMock.consumer.findUnique.mockResolvedValue({
        id: "consumer-1",
        withdrawnAt: new Date("2026-01-01"),
        appleRefreshToken: null,
      } as any);

      await expect(service.withdraw(AUDIENCE.CONSUMER, "consumer-1", "탈퇴 사유")).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.consumer.update).not.toHaveBeenCalled();
    });

    it("진행 중인 주문이 있으면 탈퇴를 막는다", async () => {
      prismaMock.consumer.findUnique.mockResolvedValue({
        id: "consumer-1",
        withdrawnAt: null,
        appleRefreshToken: null,
      } as any);
      prismaMock.order.count.mockResolvedValue(1);

      await expect(service.withdraw(AUDIENCE.CONSUMER, "consumer-1", "탈퇴 사유")).rejects.toThrow(
        new BadRequestException(AUTH_ERROR_MESSAGES.WITHDRAW_BLOCKED_ACTIVE_ORDERS),
      );
      expect(prismaMock.consumer.update).not.toHaveBeenCalled();
    });

    it("정상 탈퇴 시 식별 정보를 파기하고 phone을 재사용 불가능한 값으로 치환한다", async () => {
      prismaMock.consumer.findUnique.mockResolvedValue({
        id: "consumer-1",
        withdrawnAt: null,
        appleRefreshToken: null,
      } as any);

      await service.withdraw(AUDIENCE.CONSUMER, "consumer-1", "서비스 불만족");

      expect(prismaMock.consumer.update).toHaveBeenCalledWith({
        where: { id: "consumer-1" },
        data: expect.objectContaining({
          isActive: false,
          phone: "withdrawn_consumer-1",
          isPhoneVerified: false,
          name: null,
          nickname: null,
          googleId: null,
          kakaoId: null,
          appleId: null,
          appleEmail: null,
          appleRefreshToken: null,
          withdrawReason: "서비스 불만족",
        }),
      });
      expect(authAppleOauthServiceMock.revokeToken).not.toHaveBeenCalled();
    });

    it("Apple refresh_token이 저장되어 있으면 탈퇴 시 revoke를 호출한다 (Apple 가이드라인 5.1.1(v))", async () => {
      prismaMock.consumer.findUnique.mockResolvedValue({
        id: "consumer-1",
        withdrawnAt: null,
        appleRefreshToken: "encrypted-refresh-token",
      } as any);

      await service.withdraw(AUDIENCE.CONSUMER, "consumer-1", "탈퇴 사유");

      expect(authAppleOauthServiceMock.revokeToken).toHaveBeenCalledWith("encrypted-refresh-token");
      expect(prismaMock.consumer.update).toHaveBeenCalled();
    });
  });

  describe("seller", () => {
    it("계정이 없으면 NotFoundException을 던진다", async () => {
      prismaMock.seller.findUnique.mockResolvedValue(null);

      await expect(service.withdraw(AUDIENCE.SELLER, "seller-1", "탈퇴 사유")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("스토어의 진행 중인 주문이 있으면 탈퇴를 막는다", async () => {
      prismaMock.seller.findUnique.mockResolvedValue({
        id: "seller-1",
        withdrawnAt: null,
      } as any);
      prismaMock.order.count.mockResolvedValue(1);

      await expect(service.withdraw(AUDIENCE.SELLER, "seller-1", "탈퇴 사유")).rejects.toThrow(
        AUTH_ERROR_MESSAGES.WITHDRAW_BLOCKED_ACTIVE_ORDERS,
      );
      expect(prismaMock.seller.update).not.toHaveBeenCalled();
    });

    it("정상 탈퇴 시 익명화 데이터로 업데이트한다", async () => {
      prismaMock.seller.findUnique.mockResolvedValue({
        id: "seller-1",
        withdrawnAt: null,
      } as any);

      await service.withdraw(AUDIENCE.SELLER, "seller-1", "탈퇴 사유");

      expect(prismaMock.seller.update).toHaveBeenCalledWith({
        where: { id: "seller-1" },
        data: expect.objectContaining({ isActive: false, phone: "withdrawn_seller-1" }),
      });
      expect(prismaMock.store.deleteMany).not.toHaveBeenCalled();
    });

    it("판매자 앱 심사용 계정은 예시 주문이 진행 중이어도 탈퇴하고 심사용 가게를 지운다", async () => {
      prismaMock.seller.findUnique.mockResolvedValue({
        id: "review-seller",
        withdrawnAt: null,
        phone: SELLER_REVIEW_ACCOUNT_PHONE_MARKER,
      } as any);
      prismaMock.order.count.mockResolvedValue(6);

      await service.withdraw(AUDIENCE.SELLER, "review-seller", "심사 확인");

      expect(prismaMock.order.count).not.toHaveBeenCalled();
      expect(prismaMock.store.deleteMany).toHaveBeenCalledWith({
        where: { sellerId: "review-seller", businessNo: REVIEW_STORE_BUSINESS_NO },
      });
      expect(prismaMock.seller.update).toHaveBeenCalledWith({
        where: { id: "review-seller" },
        data: expect.objectContaining({ isActive: false, phone: "withdrawn_review-seller" }),
      });
    });
  });

  describe("admin", () => {
    it("계정이 없으면 NotFoundException을 던진다", async () => {
      prismaMock.admin.findUnique.mockResolvedValue(null);

      await expect(service.withdraw(AUDIENCE.ADMIN, "admin-1", "탈퇴 사유")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("관리자는 익명화가 아니라 완전 삭제한다 (거래기록 보존 의무 대상 아님)", async () => {
      prismaMock.admin.findUnique.mockResolvedValue({ id: "admin-1" } as any);

      await service.withdraw(AUDIENCE.ADMIN, "admin-1", "탈퇴 사유");

      expect(prismaMock.admin.delete).toHaveBeenCalledWith({ where: { id: "admin-1" } });
    });
  });

  it("알 수 없는 audience는 NotFoundException을 던진다", async () => {
    await expect(service.withdraw("unknown" as any, "id-1", "탈퇴 사유")).rejects.toThrow(
      NotFoundException,
    );
  });
});
