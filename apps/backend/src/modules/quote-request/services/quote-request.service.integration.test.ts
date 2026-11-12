import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

import { QuoteRequestReadService } from "@apps/backend/modules/quote-request/services/quote-request-read.service";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";
import { QuoteRequestWriteService } from "@apps/backend/modules/quote-request/services/quote-request-write.service";
import { QuoteRequestCleanupService } from "@apps/backend/modules/quote-request/services/quote-request-cleanup.service";
import type { UploadService } from "@apps/backend/modules/upload/upload.service";
import { getAllowedUploadUrlPrefixes } from "@apps/backend/modules/upload/utils/upload-url.util";
import type { QuoteRequestOpsAlertService } from "@apps/backend/modules/quote-request/services/quote-request-ops-alert.service";
import type { CreateQuoteRequestDto } from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 견적 요청(기획 I-46 1단계 ①)을 실제 Postgres로 확인한다:
 * 요청서 저장(마감 계산·가게 스냅샷·예산 10만원+), 운영자 알림 호출, 막는 경우, 진행 중/지난 요청 탭, 닫기, 관리자 목록.
 * 기준 시각: 2026-12-20 10:00 KST
 */
describe("견적 요청 (integration)", () => {
  const NOW = new Date("2026-12-20T10:00:00+09:00");
  const kst = (s: string) => new Date(`${s}+09:00`);

  function build() {
    const prisma = getTestPrisma();
    const notifyNewRequest = vi.fn().mockResolvedValue(undefined);
    const opsAlert = { notifyNewRequest } as unknown as QuoteRequestOpsAlertService;
    return {
      prisma,
      write: new QuoteRequestWriteService(prisma, opsAlert, {
        sendNewRequestToApps: vi.fn().mockResolvedValue(undefined),
      } as unknown as QuoteService),
      read: new QuoteRequestReadService(prisma),
      notifyNewRequest,
    };
  }

  const baseDto = (overrides: Partial<CreateQuoteRequestDto> = {}): CreateQuoteRequestDto => ({
    pickupDate: "2026-12-24",
    areaName: "연남동",
    areaSido: "서울",
    areaLatitude: 37.5662,
    areaLongitude: 126.9246,
    distanceKm: 3,
    description: "하늘색 곰돌이 케이크, 레터링 '생일 축하해'",
    size: "NO1",
    quantity: 1,
    creams: ["FRESH_CREAM"],
    budgetMin: 30000,
    budgetMax: 50000,
    entry: "HOME",
    ...overrides,
  });

  it("요청서를 저장하고 견적 마감(픽업 1시간 전)을 정하고 운영자에게 알린다", async () => {
    const { prisma, write, read, notifyNewRequest } = build();
    const consumer = await createTestConsumer(prisma);
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, {
      name: "피케이크 연남점",
      roadAddress: "서울 마포구 연남로 1",
    });

    const res = await write.createForConsumer(
      consumer.id,
      baseDto({
        pickupHourFrom: 14,
        pickupHourTo: 17,
        stores: [
          { storeId: store.id },
          { kakaoPlaceId: "12345", name: "구름베이커리", address: "서울 마포구 동교로 2" },
        ],
      }),
      NOW,
    );

    expect(res.pickupStartAt).toEqual(kst("2026-12-24T14:00:00"));
    expect(res.deadlineAt).toEqual(kst("2026-12-24T13:00:00"));
    expect(notifyNewRequest).toHaveBeenCalledTimes(1);

    const detail = await read.getForConsumer(consumer.id, res.id, NOW);
    expect(detail.status).toBe("OPEN");
    expect(detail.summary).toEqual({
      pickup: "12월 24일(목) 오후 2시~5시",
      area: "연남동 3km 안",
      cake: "1호 케이크 1개 · 생크림",
      budget: "3만~5만원",
      deadline: "12월 24일(목) 오후 1시",
    });
    expect(detail.stores.map((s) => [s.name, s.isPicakeStore])).toEqual([
      ["피케이크 연남점", true],
      ["구름베이커리", false],
    ]);
    expect(detail.stores[0].address).toBe("서울 마포구 연남로 1");
  });

  it("예산 최대가 10만원이면 '10만원 이상'으로 저장한다", async () => {
    const { prisma, write, read } = build();
    const consumer = await createTestConsumer(prisma);
    const res = await write.createForConsumer(
      consumer.id,
      baseDto({ budgetMin: 80000, budgetMax: 100000 }),
      NOW,
    );
    const detail = await read.getForConsumer(consumer.id, res.id, NOW);
    expect(detail.budgetMax).toBeNull();
    expect(detail.summary.budget).toBe("8만원 이상");
  });

  it("'이 가게에만'은 동네 없이 가게 하나로 저장한다", async () => {
    const { prisma, write, read } = build();
    const consumer = await createTestConsumer(prisma);
    const res = await write.createForConsumer(
      consumer.id,
      baseDto({
        onlyDesignatedStores: true,
        stores: [{ kakaoPlaceId: "999", name: "달빛케이크" }],
      }),
      NOW,
    );
    const detail = await read.getForConsumer(consumer.id, res.id, NOW);
    expect(detail.onlyDesignatedStores).toBe(true);
    expect(detail.areaName).toBeNull();
    expect(detail.summary.area).toBe("달빛케이크에만");

    await expect(
      write.createForConsumer(
        consumer.id,
        baseDto({ onlyDesignatedStores: true, stores: [] }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("막는 경우: 3시간 안, 사진·설명 없음, 동네 없음, 예산 단위, 같은 가게 두 번, 없는 가게", async () => {
    const { prisma, write } = build();
    const consumer = await createTestConsumer(prisma);
    const cases: Partial<CreateQuoteRequestDto>[] = [
      { pickupDate: "2026-12-20", pickupHourFrom: 12, pickupHourTo: 13 },
      { description: "   ", photoUrls: [] },
      { areaName: undefined },
      { areaLatitude: null as unknown as number },
      { distanceKm: undefined },
      { distanceKm: undefined, wholeSido: true, areaSido: undefined },
      { budgetMin: 35000 },
      { budgetMin: 50000, budgetMax: 30000 },
      {
        stores: [
          { kakaoPlaceId: "1", name: "A" },
          { kakaoPlaceId: "1", name: "A" },
        ],
      },
      { stores: [{ storeId: "없는-가게" }] },
      { stores: [{ kakaoPlaceId: "1" }] },
      { photoUrls: ["http://example.com/a.jpg"] },
    ];
    for (const c of cases) {
      await expect(write.createForConsumer(consumer.id, baseDto(c), NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(await prisma.quoteRequest.count()).toBe(0);
  });

  it("진행 중인 요청은 5개까지", async () => {
    const { prisma, write } = build();
    const consumer = await createTestConsumer(prisma);
    for (let i = 0; i < 5; i += 1) await write.createForConsumer(consumer.id, baseDto(), NOW);
    await expect(write.createForConsumer(consumer.id, baseDto(), NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("진행 중 / 지난 요청 탭: 마감이 지나면 지난 요청(마감), 닫으면 지난 요청", async () => {
    const { prisma, write, read } = build();
    const consumer = await createTestConsumer(prisma);
    const soon = await write.createForConsumer(
      consumer.id,
      baseDto({ pickupDate: "2026-12-21" }),
      NOW,
    );
    const later = await write.createForConsumer(
      consumer.id,
      baseDto({ pickupDate: "2026-12-24" }),
      NOW,
    );
    const toClose = await write.createForConsumer(
      consumer.id,
      baseDto({ pickupDate: "2026-12-25" }),
      NOW,
    );

    await write.closeForConsumer(consumer.id, toClose.id, NOW);
    await expect(write.closeForConsumer(consumer.id, toClose.id, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // 12-21 0시 픽업 → 12-20 밤 11시 마감. 12-21 낮에는 마감이 지났다
    const after = kst("2026-12-21T12:00:00");
    const ongoing = await read.listForConsumer(consumer.id, { tab: "ONGOING" }, after);
    expect(ongoing.data.map((d) => d.id)).toEqual([later.id]);
    expect(ongoing.counts).toEqual({ ongoing: 1, past: 2 });

    const past = await read.listForConsumer(consumer.id, { tab: "PAST" }, after);
    const byId = new Map(past.data.map((d) => [d.id, d]));
    expect(byId.get(soon.id)).toMatchObject({ status: "CLOSED", closeReason: "EXPIRED" });
    expect(byId.get(toClose.id)).toMatchObject({ status: "CLOSED", closeReason: "CONSUMER" });

    // 마감이 지난 요청은 닫을 수 없다
    await expect(write.closeForConsumer(consumer.id, soon.id, after)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("다른 손님의 요청은 볼 수도 닫을 수도 없다", async () => {
    const { prisma, write, read } = build();
    const owner = await createTestConsumer(prisma);
    const other = await createTestConsumer(prisma);
    const res = await write.createForConsumer(owner.id, baseDto(), NOW);
    await expect(read.getForConsumer(other.id, res.id, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(write.closeForConsumer(other.id, res.id, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("관리자 목록: 견적 받는 중은 마감이 가까운 순, 마감 탭에는 마감이 지난 요청도", async () => {
    const { prisma, write, read } = build();
    const consumer = await createTestConsumer(prisma, { nickname: "케이크러버" });
    const a = await write.createForConsumer(
      consumer.id,
      baseDto({ pickupDate: "2026-12-24" }),
      NOW,
    );
    const b = await write.createForConsumer(
      consumer.id,
      baseDto({ pickupDate: "2026-12-21" }),
      NOW,
    );
    const c = await write.createForConsumer(
      consumer.id,
      baseDto({ pickupDate: "2026-12-22" }),
      NOW,
    );

    const open = await read.listForAdmin({ status: "OPEN" }, NOW);
    expect(open.data.map((d) => d.id)).toEqual([b.id, c.id, a.id]);

    const afterB = kst("2026-12-21T09:00:00");
    const closed = await read.listForAdmin({ status: "CLOSED" }, afterB);
    expect(closed.data.map((d) => d.id)).toEqual([b.id]);

    const detail = await read.getForAdmin(a.id, NOW);
    expect(detail.consumer.nickname).toBe("케이크러버");
    expect(detail.entry).toBe("HOME");
    expect(detail.areaLatitude).toBeCloseTo(37.5662);
  });
  it("탈퇴하면 그 손님의 견적 요청(물어볼 가게 포함)과 참고 사진을 지운다", async () => {
    // 업로드 API가 발급한 주소만 받으므로 지금 환경의 업로드 주소 모양으로 만든다
    const photo = `${getAllowedUploadUrlPrefixes()[0] ?? "https://cdn.example.com/"}uploads/a.jpg`;
    const { prisma, write } = build();
    const leaving = await createTestConsumer(prisma);
    const staying = await createTestConsumer(prisma);
    await write.createForConsumer(
      leaving.id,
      baseDto({
        photoUrls: [photo],
        stores: [{ kakaoPlaceId: "9", name: "가게" }],
      }),
      NOW,
    );
    await write.createForConsumer(leaving.id, baseDto({ pickupDate: "2026-12-25" }), NOW);
    await write.createForConsumer(staying.id, baseDto(), NOW);

    const deleteFilesByUrl = vi.fn().mockResolvedValue(1);
    const cleanup = new QuoteRequestCleanupService(prisma, {
      deleteFilesByUrl,
    } as unknown as UploadService);
    const result = await cleanup.deleteAllForConsumer(leaving.id);

    expect(result).toEqual({ requests: 2, photos: 1 });
    expect(deleteFilesByUrl).toHaveBeenCalledWith([photo]);
    expect(await prisma.quoteRequest.count({ where: { consumerId: leaving.id } })).toBe(0);
    expect(await prisma.quoteRequestStore.count()).toBe(0);
    expect(await prisma.quoteRequest.count({ where: { consumerId: staying.id } })).toBe(1);
  });
});
