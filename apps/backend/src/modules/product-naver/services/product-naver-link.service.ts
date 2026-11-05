import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { ProductOwnershipUtil } from "@apps/backend/modules/product/utils/product-ownership.util";
import { ProductNaverLinkUtil } from "@apps/backend/modules/product/utils/product-naver-link.util";
import { ProductNaverImportService } from "@apps/backend/modules/product-naver/services/product-naver-import.service";
import { PRODUCT_NAVER_ERROR_MESSAGES } from "@apps/backend/modules/product-naver/constants/product-naver.constants";
import {
  NaverProductSource,
  ProductNaverLinkResponseDto,
} from "@apps/backend/modules/product-naver/dto/product-naver.dto";

/**
 * 기존 상품 ↔ 네이버 예약 상품 연결 서비스
 * 연결은 "다시 불러오기 때 어느 네이버 상품과 비교할지" 정해 두는 것이다. 상품 내용은 바꾸지 않는다.
 */
@Injectable()
export class ProductNaverLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importService: ProductNaverImportService,
  ) {}

  async linkForSeller(
    productId: string,
    bizItemId: string,
    user: JwtVerifiedPayload,
  ): Promise<ProductNaverLinkResponseDto> {
    const product = await ProductOwnershipUtil.verifyProductOwnership(
      this.prisma,
      productId,
      user.sub,
    );

    // 네이버에 실제로 있는 예약 상품인지 확인한다 (메뉴는 연결하지 않음)
    const resolved = await this.importService.resolveItem(product.storeId, bizItemId, user);
    if (resolved.source !== NaverProductSource.BOOKING) {
      throw new BadRequestException(PRODUCT_NAVER_ERROR_MESSAGES.MENU_CANNOT_LINK);
    }
    await ProductNaverLinkUtil.assertLinkable(this.prisma, product.storeId, bizItemId, productId);

    try {
      const updated = await this.prisma.product.update({
        where: { id: productId },
        data: { naverBizItemId: bizItemId, naverLinkedAt: new Date() },
        select: { id: true, naverBizItemId: true, naverLinkedAt: true },
      });
      return this.toResponse(updated);
    } catch (error) {
      if (ProductNaverLinkUtil.isDuplicateLinkError(error)) {
        throw ProductNaverLinkUtil.duplicateLinkException();
      }
      throw error;
    }
  }

  async unlinkForSeller(
    productId: string,
    user: JwtVerifiedPayload,
  ): Promise<ProductNaverLinkResponseDto> {
    await ProductOwnershipUtil.verifyProductOwnership(this.prisma, productId, user.sub);
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { naverBizItemId: null, naverLinkedAt: null },
      select: { id: true, naverBizItemId: true, naverLinkedAt: true },
    });
    return this.toResponse(updated);
  }

  private toResponse(p: {
    id: string;
    naverBizItemId: string | null;
    naverLinkedAt: Date | null;
  }): ProductNaverLinkResponseDto {
    return {
      productId: p.id,
      naverBizItemId: p.naverBizItemId,
      naverLinkedAt: p.naverLinkedAt ? p.naverLinkedAt.toISOString() : null,
    };
  }
}
