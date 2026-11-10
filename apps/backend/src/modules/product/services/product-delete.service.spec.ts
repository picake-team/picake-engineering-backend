import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { PRODUCT_ERROR_MESSAGES } from "@apps/backend/modules/product/constants/product.constants";
import { ProductOwnershipUtil } from "@apps/backend/modules/product/utils/product-ownership.util";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";

import { ProductDeleteService } from "./product-delete.service";

describe("ProductDeleteService.deleteProductForSeller", () => {
  const prismaMock = mockDeep<PrismaService>();
  const seller = { sub: "seller-1" } as JwtVerifiedPayload;
  let service: ProductDeleteService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(ProductOwnershipUtil, "verifyProductOwnership").mockResolvedValue({} as never);
    const moduleRef = await Test.createTestingModule({
      providers: [ProductDeleteService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(ProductDeleteService);
  });

  it("주문이 있으면 지우지 않는다(지우면 주문까지 함께 지워진다)", async () => {
    prismaMock.order.count.mockResolvedValue(2);

    await expect(service.deleteProductForSeller("product-1", seller)).rejects.toThrow(
      new BadRequestException(PRODUCT_ERROR_MESSAGES.HAS_ORDERS),
    );
    expect(prismaMock.product.delete).not.toHaveBeenCalled();
  });

  it("주문이 없으면 지운다", async () => {
    prismaMock.order.count.mockResolvedValue(0);
    prismaMock.product.delete.mockResolvedValue({} as never);

    await service.deleteProductForSeller("product-1", seller);

    expect(prismaMock.order.count).toHaveBeenCalledWith({ where: { productId: "product-1" } });
    expect(prismaMock.product.delete).toHaveBeenCalledWith({ where: { id: "product-1" } });
  });
});
