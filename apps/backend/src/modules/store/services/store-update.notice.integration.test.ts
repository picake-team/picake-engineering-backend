import { describe, expect, it, vi } from "vitest";

import { NotificationService } from "@apps/backend/modules/notification/services/notification.service";
import { SellerStoreNoticeService } from "@apps/backend/modules/notification/services/seller-store-notice.service";
import type { NotificationGateway } from "@apps/backend/modules/notification/gateways/notification.gateway";
import type { SellerFcmPushService } from "@apps/backend/modules/fcm/services/seller-fcm-push.service";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { StoreUpdateService } from "@apps/backend/modules/store/services/store-update.service";
import type { UpdateStoreRequestDto } from "@apps/backend/modules/store/dto/store-update.dto";
import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import { createTestSeller, createTestStore } from "@apps/backend/test/integration/factories";

/** 정산 계좌가 바뀌면 그 사장님에게만 알린다(운영자 2026-11-18) — 판매자 화면 알림 + 판매자 앱 푸시 */
describe("스토어 수정 — 정산 계좌가 바뀌면 사장님 알림 (integration)", () => {
  async function setup() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, {
      name: "구름베이커리",
      bankName: "KB_KOOKMIN",
      bankAccountNumber: "123456-01-234567",
      accountHolderName: "김사장",
    });
    const notifications = new NotificationService(prisma);
    const gateway = { emitSellerNotification: vi.fn() };
    const push = { sendToSeller: vi.fn().mockResolvedValue({ deviceCount: 1 }) };
    const notice = new SellerStoreNoticeService(
      prisma,
      notifications,
      gateway as unknown as NotificationGateway,
      push as unknown as SellerFcmPushService,
    );
    const service = new StoreUpdateService(prisma, notice);
    const user = { sub: seller.id, aud: "seller", type: "access" } as JwtVerifiedPayload;
    const dto = (over: Partial<UpdateStoreRequestDto> = {}) =>
      ({
        name: "구름베이커리",
        address: "서울 마포구 연남동 1",
        roadAddress: "서울 마포구 동교로 1",
        detailAddress: "1층",
        zonecode: "03900",
        latitude: 37.56,
        longitude: 126.92,
        phoneNumber: "0212345678",
        bankName: "KB_KOOKMIN",
        bankAccountNumber: "123456-01-234567",
        accountHolderName: "김사장",
        refundCancellationPolicy: {
          rules: [{ daysBeforePickup: 0, refundDescription: "환불 불가" }],
        },
        ...over,
      }) as UpdateStoreRequestDto;
    return { prisma, seller, store, notifications, gateway, push, service, user, dto };
  }

  it("계좌가 바뀌면 판매자 화면 알림(스토어 안내)과 푸시를 보내고, 목록·안 읽은 수·읽음에 들어간다", async () => {
    const t = await setup();
    await t.service.updateStoreForSeller(
      t.store.id,
      t.dto({ bankName: "TOSS_BANK" as never, bankAccountNumber: "1000-9876-5432" }),
      t.user,
    );
    await vi.waitFor(() => expect(t.push.sendToSeller).toHaveBeenCalledTimes(1));

    const pushed = t.push.sendToSeller.mock.calls[0][0];
    expect(pushed.title).toBe("정산 계좌가 바뀌었어요");
    expect(pushed.body).toMatch(/^토스뱅크 ····5432 · \d+\/\d+ \d\d:\d\d\. 직접 바꾸지 않았다면/);
    expect(pushed.body).not.toContain("9876");
    expect(pushed.data).toMatchObject({
      type: "SELLER_STORE_NOTICE",
      path: `/stores/${t.store.id}/edit`,
    });
    expect(t.gateway.emitSellerNotification).toHaveBeenCalledWith(
      t.seller.id,
      expect.objectContaining({ category: "STORE", orderId: null, storeId: t.store.id }),
    );

    const list = await t.notifications.listSellerWebForStore({
      userId: t.seller.id,
      storeId: t.store.id,
      unreadOnly: false,
      page: 1,
      limit: 20,
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      category: "STORE",
      orderId: null,
      title: "정산 계좌가 바뀌었어요",
    });
    expect(await t.notifications.countUnreadSellerWebForStore(t.seller.id, t.store.id)).toBe(1);
    await t.notifications.markReadSellerWeb({
      userId: t.seller.id,
      notificationId: list.items[0].id,
    });
    expect(await t.notifications.countUnreadSellerWebForStore(t.seller.id, t.store.id)).toBe(0);
  });

  it("계좌가 그대로면(이름·설명만 바꿈) 알리지 않는다", async () => {
    const t = await setup();
    await t.service.updateStoreForSeller(t.store.id, t.dto({ description: "새 소개" }), t.user);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.push.sendToSeller).not.toHaveBeenCalled();
    expect(await t.prisma.userNotification.count({ where: { sellerId: t.seller.id } })).toBe(0);
  });

  it("운영자 대신 입력으로는 계좌를 바꿀 수 없어 알림도 없다", async () => {
    const t = await setup();
    const actor = { ...t.user, actor: { type: "ADMIN", adminId: "a1", sessionId: "s1" } } as never;
    await expect(
      t.service.updateStoreForSeller(t.store.id, t.dto({ bankAccountNumber: "999" }), actor),
    ).rejects.toThrow(ACT_AS_ERROR_MESSAGES.BANK_ACCOUNT_LOCKED);
    expect(t.push.sendToSeller).not.toHaveBeenCalled();
  });

  it('대신 입력 중에는 손님 연락 채널 "손님에게 보이기"를 바꿀 수 없고, 지금 값 그대로면 저장된다(기획 I-01·P-93)', async () => {
    const t = await setup();
    const actor = { ...t.user, actor: { type: "ADMIN", adminId: "a1", sessionId: "s1" } } as never;
    const same = {
      chatInquiryVisible: true,
      kakaoChannelVisible: true,
      instagramVisible: true,
      phoneVisible: true,
    };
    await expect(
      t.service.updateStoreForSeller(t.store.id, t.dto({ ...same, phoneVisible: false }), actor),
    ).rejects.toThrow(ACT_AS_ERROR_MESSAGES.VISIBILITY_OWNER_ONLY);
    await t.service.updateStoreForSeller(
      t.store.id,
      t.dto({ ...same, description: "대신 고친 소개" }),
      actor,
    );
    const saved = await t.prisma.store.findUniqueOrThrow({ where: { id: t.store.id } });
    expect(saved).toMatchObject({ description: "대신 고친 소개", phoneVisible: true });

    // 사장님은 바꿀 수 있다
    await t.service.updateStoreForSeller(
      t.store.id,
      t.dto({ ...same, phoneVisible: false }),
      t.user,
    );
    expect(
      (await t.prisma.store.findUniqueOrThrow({ where: { id: t.store.id } })).phoneVisible,
    ).toBe(false);
  });
});
