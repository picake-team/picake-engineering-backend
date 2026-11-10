import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { ProductOwnershipUtil } from "@apps/backend/modules/product/utils/product-ownership.util";
import { PRODUCT_ERROR_MESSAGES } from "@apps/backend/modules/product/constants/product.constants";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";

@Injectable()
export class ProductDeleteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 상품 삭제 (판매자용)
   * 주문이 하나라도 있으면 지우지 않는다. 상품을 지우면 DB에서 그 상품의 주문·후기까지 함께 지워져
   * (orders.product_id ON DELETE CASCADE) 손님 주문 내역과 거래 기록이 사라지기 때문이다.
   * 팔지 않으려면 판매중지나 숨김으로 바꾼다.
   */
  async deleteProductForSeller(id: string, user: JwtVerifiedPayload) {
    // 상품 소유권 확인
    await ProductOwnershipUtil.verifyProductOwnership(this.prisma, id, user.sub, {
      sellerId: true,
    });

    const orderCount = await this.prisma.order.count({ where: { productId: id } });
    if (orderCount > 0) {
      throw new BadRequestException(PRODUCT_ERROR_MESSAGES.HAS_ORDERS);
    }

    try {
      await this.prisma.product.delete({
        where: {
          id,
        },
      });
    } catch (error: unknown) {
      LoggerUtil.log(
        `상품 삭제 실패: 트랜잭션 에러 - userId: ${user.sub}, productId: ${id}, error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
