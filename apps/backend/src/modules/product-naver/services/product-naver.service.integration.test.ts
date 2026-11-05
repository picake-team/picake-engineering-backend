import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import type { NaverPlaceService } from "@apps/backend/modules/naver-place/naver-place.service";
import type { NaverBookingService } from "@apps/backend/modules/naver-place/naver-booking.service";
import type { UploadService } from "@apps/backend/modules/upload/upload.service";
import type { NaverPlaceInfo } from "@apps/backend/modules/naver-place/utils/naver-place-parser.util";
import type { NaverBookingItem } from "@apps/backend/modules/naver-place/utils/naver-booking-parser.util";
import { ProductNaverImportService } from "@apps/backend/modules/product-naver/services/product-naver-import.service";
import { ProductNaverLinkService } from "@apps/backend/modules/product-naver/services/product-naver-link.service";
import { ProductNaverLinkUtil } from "@apps/backend/modules/product/utils/product-naver-link.util";
import { NaverProductSource } from "@apps/backend/modules/product-naver/dto/product-naver.dto";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 네이버 상품 가져오기·연결은 네이버를 실제로 부르지 않고(mock),
 * 연결한 스토어에서만 동작하는지, 같은 네이버 상품이 두 상품에 연결되지 않는지, 사진을 순번으로만 옮기는지 확인합니다.
 */
describe("네이버 상품 가져오기·연결 (integration)", () => {
  const bookingItem = (bizItemId: string, name = "샘플 케이크"): NaverBookingItem => ({
    bizItemId,
    name,
    desc: "샘플 설명",
    price: 0,
    subType: "RESTAURANT_PICKUP",
    requiresOption: true,
    isClosed: false,
    precautions: [],
    imageUrls: ["https://naverbooking-phinf.pstatic.net/a.jpg"],
  });

  const placeInfo = (over: Partial<NaverPlaceInfo> = {}): NaverPlaceInfo =>
    ({
      placeId: "1234567890",
      menus: [
        {
          name: "샘플 메뉴",
          price: "30,000원",
          description: "메뉴 설명",
          imageUrl: null,
          isRecommended: false,
        },
      ],
      bookingBusinessId: "555",
      bookingBusinessTypeId: 6,
      ...over,
    }) as NaverPlaceInfo;

  function build(info: NaverPlaceInfo = placeInfo()) {
    const prisma = getTestPrisma();
    const naverPlaceService = {
      getPlace: vi.fn(async () => ({ info, fetchedAt: new Date() })),
    } as unknown as NaverPlaceService;
    const naverBookingService = {
      listItems: vi.fn(async () => ({
        items: [bookingItem("1001"), bookingItem("1002", "다른 케이크")],
        fetchedAt: new Date(),
      })),
      getItemOptions: vi.fn(async () => ({
        status: "OK",
        options: [
          {
            optionId: "1",
            categoryName: null,
            name: "샘플 케이크 1호",
            desc: "지름15cm",
            price: 54000,
            normalPrice: null,
            isSoldOut: false,
            remainStock: null,
            imageUrl: null,
          },
          {
            optionId: "2",
            categoryName: null,
            name: "샘플 바스크치즈",
            desc: "옵션 설명",
            price: 32000,
            normalPrice: null,
            isSoldOut: false,
            remainStock: null,
            imageUrl: "https://naverbooking-phinf.pstatic.net/option.jpg",
          },
        ],
      })),
      downloadImage: vi.fn(async () => ({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        mimetype: "image/jpeg",
      })),
    } as unknown as NaverBookingService;
    const uploadService = {
      uploadFile: vi.fn(async () => "https://cdn.example.com/uploaded.jpg"),
    } as unknown as UploadService;
    const importService = new ProductNaverImportService(
      prisma,
      naverPlaceService,
      naverBookingService,
      uploadService,
    );
    const linkService = new ProductNaverLinkService(prisma, importService);
    return { prisma, importService, linkService, naverBookingService, uploadService };
  }

  async function setup(connected = true) {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, {
      naverPlaceId: connected ? "1234567890" : null,
    });
    const user = { sub: seller.id } as JwtVerifiedPayload;
    return { prisma, store, user };
  }

  it("네이버 매장을 연결하지 않은 스토어는 목록을 볼 수 없다", async () => {
    const { store, user } = await setup(false);
    const { importService } = build();
    await expect(importService.listForSeller(store.id, user)).rejects.toThrow(BadRequestException);
  });

  it("예약 상품 목록에 이미 연결한 Picake 상품을 알려 준다", async () => {
    const { prisma, store, user } = await setup();
    const product = await createTestProduct(prisma, store.id, { naverBizItemId: "1001" });
    const { importService } = build();

    const list = await importService.listForSeller(store.id, user);

    expect(list.source).toBe(NaverProductSource.BOOKING);
    expect(list.items.map((i) => [i.itemKey, i.linkedProduct?.id ?? null])).toEqual([
      ["1001", product.id],
      ["1002", null],
    ]);
  });

  it("예약을 안 쓰는 매장은 메뉴를 돌려주고, 메뉴 상세는 가격만 제안한다", async () => {
    const { store, user } = await setup();
    const { importService } = build(placeInfo({ bookingBusinessId: null }));

    const list = await importService.listForSeller(store.id, user);
    expect(list.source).toBe(NaverProductSource.MENU);
    expect(list.items[0].itemKey).toBe("menu-0");

    const detail = await importService.detailForSeller(store.id, "menu-0", user);
    expect(detail.suggestedSalePrice).toBe(30000);
    expect(detail.options).toEqual([]);
  });

  it("예약 상품 상세는 옵션을 사이즈 후보로 바꿔 준다", async () => {
    const { store, user } = await setup();
    const { importService } = build();

    const detail = await importService.detailForSeller(store.id, "1001", user);
    expect(detail.options[0]).toMatchObject({ role: "SIZE", sizeDisplayName: "1호", lengthCm: 15 });
    expect(detail.suggestedSalePrice).toBe(54000);
  });

  it("네이버에 없는 상품은 404", async () => {
    const { store, user } = await setup();
    const { importService } = build();
    await expect(importService.detailForSeller(store.id, "9999", user)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("사진은 순번으로 고른 것만 Picake에 올리고, 없는 순번은 실패로 알려 준다", async () => {
    const { store, user } = await setup();
    const { importService, naverBookingService, uploadService } = build();

    const result = await importService.importImagesForSeller(store.id, "1001", [0, 3], user);

    expect(result).toEqual({ urls: ["https://cdn.example.com/uploaded.jpg"], failedIndexes: [3] });
    expect(naverBookingService.downloadImage).toHaveBeenCalledWith(
      "https://naverbooking-phinf.pstatic.net/a.jpg",
    );
    expect(uploadService.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("상품을 네이버 상품과 연결하고 끊는다", async () => {
    const { prisma, store, user } = await setup();
    const product = await createTestProduct(prisma, store.id);
    const { linkService } = build();

    const linked = await linkService.linkForSeller(product.id, "1002", user);
    expect(linked.naverBizItemId).toBe("1002");

    await linkService.unlinkForSeller(product.id, user);
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.naverBizItemId).toBeNull();
    expect(saved.naverLinkedAt).toBeNull();
  });

  it("같은 네이버 상품은 같은 스토어의 두 상품에 연결할 수 없다", async () => {
    const { prisma, store, user } = await setup();
    await createTestProduct(prisma, store.id, { name: "먼저 연결한 상품", naverBizItemId: "1001" });
    const second = await createTestProduct(prisma, store.id);
    const { linkService } = build();

    await expect(linkService.linkForSeller(second.id, "1001", user)).rejects.toThrow(
      ConflictException,
    );
    await expect(ProductNaverLinkUtil.assertLinkable(prisma, store.id, "1001")).rejects.toThrow(
      "먼저 연결한 상품",
    );
  });

  it("다른 스토어는 같은 네이버 상품 ID를 따로 연결할 수 있다 (DB 제약)", async () => {
    const a = await setup();
    const b = await setup();
    await createTestProduct(a.prisma, a.store.id, { naverBizItemId: "1001" });
    await expect(
      createTestProduct(b.prisma, b.store.id, { naverBizItemId: "1001" }),
    ).resolves.toBeTruthy();
    await expect(
      createTestProduct(a.prisma, a.store.id, { naverBizItemId: "1001" }),
    ).rejects.toSatisfy((e: unknown) => ProductNaverLinkUtil.isDuplicateLinkError(e));
  });

  it("메뉴는 상품과 연결할 수 없다", async () => {
    const { prisma, store, user } = await setup();
    const product = await createTestProduct(prisma, store.id);
    const { linkService } = build();
    await expect(linkService.linkForSeller(product.id, "menu-0", user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("옵션 하나를 상품으로 가져오면 옵션 이름·가격·사진을 쓰고, 그 키로 연결된다", async () => {
    const { prisma, store, user } = await setup();
    const { importService, linkService, naverBookingService } = build();

    const detail = await importService.detailForSeller(store.id, "1001-o2", user);
    expect(detail).toMatchObject({
      name: "샘플 바스크치즈",
      suggestedSalePrice: 32000,
      imageUrls: ["https://naverbooking-phinf.pstatic.net/option.jpg"],
      options: [],
    });

    await importService.importImagesForSeller(store.id, "1001-o2", [0], user);
    expect(naverBookingService.downloadImage).toHaveBeenLastCalledWith(
      "https://naverbooking-phinf.pstatic.net/option.jpg",
    );

    const product = await createTestProduct(prisma, store.id);
    const linked = await linkService.linkForSeller(product.id, "1001-o2", user);
    expect(linked.naverBizItemId).toBe("1001-o2");

    // 상품 상세에서 그 옵션은 이미 가져온 상품으로 표시된다
    const parent = await importService.detailForSeller(store.id, "1001", user);
    expect(parent.options.find((o) => o.optionId === "2")?.linkedProduct?.id).toBe(product.id);
  });

  it("없는 옵션은 404", async () => {
    const { store, user } = await setup();
    const { importService } = build();
    await expect(importService.detailForSeller(store.id, "1001-o999", user)).rejects.toThrow(
      NotFoundException,
    );
  });
});
