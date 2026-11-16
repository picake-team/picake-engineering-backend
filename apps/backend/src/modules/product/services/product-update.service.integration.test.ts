import { describe, expect, it } from "vitest";

import { ProductUpdateService } from "@apps/backend/modules/product/services/product-update.service";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import {
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/** 판매가만 바꿔도 옵션 버전이 올라야 예약 창을 연 손님이 옛 가격으로 막히지 않는다(P-04, 11-16 검토) */
describe("상품 수정 — 옵션 버전", () => {
  async function setup() {
    const prisma = getTestPrisma();
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id);
    const product = await createTestProduct(prisma, store.id, {
      salePrice: 30000,
      originalPrice: 30000,
    });
    const service = new ProductUpdateService(prisma);
    const user = { sub: seller.id } as JwtVerifiedPayload;
    return { prisma, product, service, user };
  }

  it("판매가가 바뀌면 옵션 버전을 올린다", async () => {
    const { prisma, product, service, user } = await setup();
    const before = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
      .optionsVersion;

    await service.updateProductForSeller(product.id, { salePrice: 28000 } as never, user);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.salePrice).toBe(28000);
    expect(after.optionsVersion).toBe(before + 1);
  });

  it("같은 판매가를 다시 보내면(이름만 바꿈 등) 버전을 올리지 않는다", async () => {
    const { prisma, product, service, user } = await setup();
    const before = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
      .optionsVersion;

    await service.updateProductForSeller(
      product.id,
      { salePrice: 30000, name: "새 이름" } as never,
      user,
    );

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.optionsVersion).toBe(before);
  });
});
