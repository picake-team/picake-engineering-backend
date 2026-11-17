import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ManualOrderSource } from "@apps/backend/infra/database/prisma/generated/client";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { ManualOrderService } from "@apps/backend/modules/manual-order/services/manual-order.service";
import { CalendarFeedService } from "@apps/backend/modules/manual-order/services/calendar-feed.service";
import { SellerOrderStatisticsService } from "@apps/backend/modules/statistics/seller/services/seller-order-statistics.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 직접 적은 주문(기획 I-42)을 실제 Postgres로: 내 스토어만, 픽업 날·시각 순(시각 없으면 맨 뒤),
 * 통계(픽업 날 기준·오늘까지·금액 적은 주문만 매출), 다른 캘린더로 내보내기(주소·손님 이름·새 주소).
 */
describe("직접 적은 주문 (integration)", () => {
  // 업로드 API가 발급하는 주소(테스트 환경의 CLOUDFRONT_DOMAIN)
  const cdn = (name: string) => `https://${process.env.CLOUDFRONT_DOMAIN ?? "cdn.test"}/${name}`;
  const input = (overrides: Partial<Record<string, unknown>> = {}) => ({
    pickupDate: "2026-12-24",
    pickupTime: "12:00",
    cakeName: "2호 초코 리스",
    lettering: "메리 크리스마스 지우야",
    price: 45000,
    paid: true,
    customerName: "한지우",
    source: ManualOrderSource.KAKAO,
    memo: null,
    photoUrls: [],
    ...overrides,
  });

  async function setup() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, { name: "보늬케이크" });
    const other = await createTestSeller(prisma);
    const upload = { deleteFilesByUrl: vi.fn().mockResolvedValue(0) };
    return {
      prisma,
      seller,
      store,
      other,
      upload,
      service: new ManualOrderService(prisma, upload as never),
    };
  }

  it("적고 기간으로 불러온다: 날·시각 순, 시각 없는 주문은 그날 맨 뒤", async () => {
    const { seller, store, service } = await setup();
    await service.create(
      seller.id,
      store.id,
      input({ pickupTime: null, cakeName: "미정 케이크" }) as any,
    );
    await service.create(
      seller.id,
      store.id,
      input({ pickupTime: "15:00", cakeName: "세 시" }) as any,
    );
    await service.create(
      seller.id,
      store.id,
      input({ pickupTime: "11:00", cakeName: "열한 시" }) as any,
    );
    await service.create(
      seller.id,
      store.id,
      input({ pickupDate: "2027-01-02", cakeName: "다음 해" }) as any,
    );

    const rows = await service.list(seller.id, store.id, "2026-12-01", "2026-12-31");
    expect(rows.map((r) => r.cakeName)).toEqual(["열한 시", "세 시", "미정 케이크"]);
  });

  it("다른 사장님 스토어는 볼 수도 고칠 수도 없다", async () => {
    const { seller, store, other, service } = await setup();
    const row = await service.create(seller.id, store.id, input() as any);
    await expect(
      service.list(other.id, store.id, "2026-12-01", "2026-12-31"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.get(other.id, store.id, row.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(other.id, store.id, row.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("뺀 사진·지운 주문의 사진 파일을 지우고, 탈퇴하면 모두 지운다", async () => {
    const { prisma, seller, store, upload, service } = await setup();
    const a = await service.create(
      seller.id,
      store.id,
      input({ photoUrls: [cdn("a.jpg"), cdn("b.jpg")] }) as any,
    );
    await service.update(seller.id, store.id, a.id, input({ photoUrls: [cdn("a.jpg")] }) as any);
    expect(upload.deleteFilesByUrl).toHaveBeenLastCalledWith([cdn("b.jpg")]);
    await service.remove(seller.id, store.id, a.id);
    expect(upload.deleteFilesByUrl).toHaveBeenLastCalledWith([cdn("a.jpg")]);

    await service.create(seller.id, store.id, input({ photoUrls: [cdn("c.jpg")] }) as any);
    await service.create(seller.id, store.id, input() as any);
    const result = await service.deleteAllForSeller(seller.id);
    expect(result.orders).toBe(2);
    expect(upload.deleteFilesByUrl).toHaveBeenLastCalledWith([cdn("c.jpg")]);
    expect(await prisma.manualOrder.count({ where: { storeId: store.id } })).toBe(0);
  });

  it("입금만 바꾸고, 지운다", async () => {
    const { seller, store, service } = await setup();
    const row = await service.create(seller.id, store.id, input({ paid: false }) as any);
    expect((await service.setPaid(seller.id, store.id, row.id, true)).paid).toBe(true);
    await service.remove(seller.id, store.id, row.id);
    await expect(service.get(seller.id, store.id, row.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("통계: 픽업 날이 기간 안이고 오늘까지 지난 주문만, Picake 숫자에는 안 섞인다", async () => {
    const { prisma, seller, store, service } = await setup();
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const day = (offset: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    await service.create(seller.id, store.id, input({ pickupDate: day(-1), price: 30000 }) as any);
    await service.create(
      seller.id,
      store.id,
      input({ pickupDate: day(0), price: 20000, source: ManualOrderSource.INSTAGRAM }) as any,
    );
    await service.create(seller.id, store.id, input({ pickupDate: day(-1), price: null }) as any);
    // 아직 안 온 픽업은 세지 않는다
    await service.create(seller.id, store.id, input({ pickupDate: day(1), price: 99000 }) as any);

    const stats = new SellerOrderStatisticsService(prisma);
    const overview = await stats.getOverview(
      { storeId: store.id, startDate: day(-3), endDate: day(3) },
      { sub: seller.id } as any,
    );
    expect(overview.totalSales).toBe(0);
    expect(overview.manual.totalSales).toBe(50000);
    expect(overview.manual.totalOrders).toBe(3);
    expect(overview.manual.bySource).toEqual([
      { source: ManualOrderSource.KAKAO, sales: 30000, orders: 2 },
      { source: ManualOrderSource.INSTAGRAM, sales: 20000, orders: 1 },
    ]);
  });

  it("내보내기: 처음 열면 주소를 만들고, 손님 이름은 켤 때만, 새로 만들면 옛 주소는 404", async () => {
    const { prisma, seller, store, service } = await setup();
    const consumer = await createTestConsumer(prisma);
    const product = await createTestProduct(prisma, store.id);
    await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      { pickupDate: new Date("2026-12-24T02:00:00.000Z"), orderStatus: OrderStatus.CONFIRMED },
    );
    await service.create(seller.id, store.id, input({ paid: false }) as any);

    const feed = new CalendarFeedService(prisma);
    const now = new Date("2026-11-17T03:00:00.000Z");
    const first = await feed.get(seller.id, store.id);
    expect(first.path).toMatch(/^\/v1\/seller\/calendar-feeds\/[A-Za-z0-9_-]{32}\.ics$/);
    expect((await feed.get(seller.id, store.id)).path).toBe(first.path);

    const token = first.path.split("/").pop()!.replace(".ics", "");
    const hidden = await feed.buildIcs(token, now);
    expect(hidden.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(hidden).toContain("SUMMARY:2호 초코 리스 · 카톡");
    expect(hidden).toContain("DESCRIPTION:입금 전");
    expect(hidden).not.toContain("한지우");

    await feed.updateSettings(seller.id, store.id, true);
    expect(await feed.buildIcs(token, now)).toContain("SUMMARY:2호 초코 리스 · 카톡 · 한지우");

    const next = await feed.reset(seller.id, store.id);
    expect(next.path).not.toBe(first.path);
    await expect(feed.buildIcs(token, now)).rejects.toBeInstanceOf(NotFoundException);
  });
});
