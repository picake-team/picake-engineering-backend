import { describe, expect, it, vi } from "vitest";

import { UploadService } from "@apps/backend/modules/upload/upload.service";
import type { UploadCreateService } from "@apps/backend/modules/upload/services/upload-create.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

const CDN = "https://cdn.example";

describe("UploadService.deleteFilesByUrl — 아직 쓰는 주소는 지우지 않는다(11-16 검토)", () => {
  async function build() {
    const prisma = getTestPrisma();
    const deleteInS3 = vi.fn(async (urls: string[]) => urls.length);
    const service = new UploadService(
      { deleteFilesByUrl: deleteInS3 } as unknown as UploadCreateService,
      prisma,
    );
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, { logoImageUrl: `${CDN}/logo.jpg` });
    const product = await createTestProduct(prisma, store.id, {
      images: [`${CDN}/product.jpg`],
    });
    const consumer = await createTestConsumer(prisma);
    return { prisma, service, deleteInS3, store, product, consumer };
  }

  it("상품 사진·가게 로고 주소가 섞여 들어와도 그 파일은 지우지 않고, 아무도 안 쓰는 주소만 지운다", async () => {
    const { service, deleteInS3 } = await build();

    const deleted = await service.deleteFilesByUrl([
      `${CDN}/product.jpg`,
      `${CDN}/logo.jpg`,
      `${CDN}/mine.jpg`,
      `${CDN}/mine.jpg`,
    ]);

    expect(deleteInS3).toHaveBeenCalledWith([`${CDN}/mine.jpg`]);
    expect(deleted).toBe(1);
  });

  it("견적 예약 주문이 쓰는 사진(주문 사진)은 견적 요청을 지운 뒤에도 남긴다", async () => {
    const { prisma, service, deleteInS3, store, product, consumer } = await build();
    await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      { productImages: [`${CDN}/quote-photo.jpg`] },
    );

    const deleted = await service.deleteFilesByUrl([`${CDN}/quote-photo.jpg`]);

    expect(deleteInS3).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it("빈 목록이면 DB도 S3도 부르지 않는다", async () => {
    const { service, deleteInS3 } = await build();
    expect(await service.deleteFilesByUrl([])).toBe(0);
    expect(deleteInS3).not.toHaveBeenCalled();
  });
});
