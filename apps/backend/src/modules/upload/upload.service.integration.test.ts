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
import { testUploadPathStyleUrl, testUploadUrl } from "@apps/backend/test/integration/upload-url";

const url = testUploadUrl;

describe("UploadService.deleteFilesByUrl — 아직 쓰는 파일은 지우지 않는다(11-16·11-17 검토)", () => {
  async function build() {
    const prisma = getTestPrisma();
    const deleteInS3 = vi.fn(async (urls: string[]) => urls.length);
    const service = new UploadService(
      { deleteFilesByUrl: deleteInS3 } as unknown as UploadCreateService,
      prisma,
    );
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, { logoImageUrl: url("logo.jpg") });
    const product = await createTestProduct(prisma, store.id, {
      images: [url("1731_ab12cd34.jpg")],
    });
    const consumer = await createTestConsumer(prisma);
    return { prisma, service, deleteInS3, store, product, consumer };
  }

  it("상품 사진·가게 로고 주소가 섞여 들어와도 그 파일은 지우지 않고, 아무도 안 쓰는 주소만 지운다", async () => {
    const { service, deleteInS3 } = await build();

    const deleted = await service.deleteFilesByUrl([
      url("1731_ab12cd34.jpg"),
      url("logo.jpg"),
      url("mine.jpg"),
      url("mine.jpg"),
    ]);

    expect(deleteInS3).toHaveBeenCalledWith([url("mine.jpg")]);
    expect(deleted).toBe(1);
  });

  it("같은 파일 주소에 ?·#·다른 인코딩·S3 경로 꼴을 붙여도 남의 상품 사진은 지우지 않는다(11-17)", async () => {
    const { service, deleteInS3 } = await build();

    const deleted = await service.deleteFilesByUrl([
      `${url("1731_ab12cd34.jpg")}?x`,
      `${url("1731_ab12cd34.jpg")}#x`,
      url("1731%5Fab12cd34.jpg"),
      testUploadPathStyleUrl("1731_ab12cd34.jpg"),
    ]);

    expect(deleteInS3).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it("상품이 S3 경로 꼴로 저장한 파일을 다른 꼴 주소로 지우려 해도 남긴다", async () => {
    const { prisma, service, deleteInS3, store } = await build();
    await createTestProduct(prisma, store.id, { images: [testUploadPathStyleUrl("old.jpg")] });

    expect(await service.deleteFilesByUrl([url("old.jpg")])).toBe(0);
    expect(deleteInS3).not.toHaveBeenCalled();
  });

  it("업로드 API가 만든 파일(uploads/)이 아니거나 이 서비스 주소가 아니면 지우지 않는다", async () => {
    const { service, deleteInS3 } = await build();
    const outside = url("x.jpg").replace("/uploads/x.jpg", "/backups/db.sql.gz");

    expect(await service.deleteFilesByUrl([outside, "https://evil.example/uploads/x.jpg"])).toBe(0);
    expect(deleteInS3).not.toHaveBeenCalled();
  });

  it("견적 예약 주문이 쓰는 사진(주문 사진)은 견적 요청을 지운 뒤에도 남긴다", async () => {
    const { prisma, service, deleteInS3, store, product, consumer } = await build();
    await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      { productImages: [url("quote-photo.jpg")] },
    );

    const deleted = await service.deleteFilesByUrl([url("quote-photo.jpg")]);

    expect(deleteInS3).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it("직접 적은 주문(기획 I-42)이 쓰는 사진도 남긴다", async () => {
    const { prisma, service, deleteInS3, store } = await build();
    await prisma.manualOrder.create({
      data: {
        storeId: store.id,
        pickupDate: "2026-12-24",
        cakeName: "2호 초코",
        source: "KAKAO",
        photoUrls: [url("manual.jpg")],
      },
    });

    expect(await service.deleteFilesByUrl([url("manual.jpg"), url("gone.jpg")])).toBe(1);
    expect(deleteInS3).toHaveBeenCalledWith([url("gone.jpg")]);
  });

  it("빈 목록이면 DB도 S3도 부르지 않는다", async () => {
    const { service, deleteInS3 } = await build();
    expect(await service.deleteFilesByUrl([])).toBe(0);
    expect(deleteInS3).not.toHaveBeenCalled();
  });
});
