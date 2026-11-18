import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import {
  EnableStatus,
  PRODUCT_ERROR_MESSAGES,
} from "@apps/backend/modules/product/constants/product.constants";
import { ProductMapperUtil } from "@apps/backend/modules/product/utils/product-mapper.util";
import { LikeProductDetailService } from "@apps/backend/modules/like/services/like-product-detail.service";
import { ProductOwnershipUtil } from "@apps/backend/modules/product/utils/product-ownership.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { assertActAsStore } from "@apps/backend/modules/act-as/utils/act-as-scope.util";

@Injectable()
export class ProductDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly likeProductDetailService: LikeProductDetailService,
  ) {}

  /**
   * 상품 상세 조회 (사용자용)
   * @param id - 상품 ID
   * @param user - 로그인한 사용자 정보 (옵셔널)
   */
  async getProductDetailForUser(id: string, user?: JwtVerifiedPayload) {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
      include: {
        reviews: ProductMapperUtil.REVIEWS_INCLUDE_FOR_STATS,
        store: {
          select: ProductMapperUtil.STORE_INFO_SELECT,
        },
      },
    });

    if (!product || product.visibilityStatus !== EnableStatus.ENABLE) {
      LoggerUtil.log(
        `상품 상세 조회 실패: 상품 없음 또는 비공개 - productId: ${id}, visibilityStatus: ${product?.visibilityStatus || "없음"}`,
      );
      throw new NotFoundException(PRODUCT_ERROR_MESSAGES.NOT_FOUND);
    }

    // 정지·탈퇴한 사장님 가게 상품은 목록에서 빠지고 예약도 막힌다. 링크로 열면 판매중지로 보여
    // 예약 창을 끝까지 채운 뒤에야 막히지 않게 한다(11-15 운영자)
    const sellerActive =
      (await this.prisma.store.count({
        where: { id: product.storeId, seller: { isActive: true } },
      })) > 0;
    const productForUser = sellerActive
      ? product
      : { ...product, salesStatus: EnableStatus.DISABLE };

    let isLiked: boolean | null = null;
    if (user?.sub) {
      try {
        isLiked = await this.likeProductDetailService.isProductLiked(user.sub, id);
      } catch (error: unknown) {
        if (!(error instanceof NotFoundException)) {
          throw error;
        }
        isLiked = null;
      }
    }

    return ProductMapperUtil.mapToProductResponse(productForUser, isLiked, "consumerDetail");
  }

  /**
   * 판매자용 상품 상세 조회 (판매자용)
   * 자신이 소유한 스토어의 상품만 조회 가능합니다.
   */
  async getProductDetailForSeller(id: string, user: JwtVerifiedPayload) {
    // 상품 소유권 확인
    const owned = await ProductOwnershipUtil.verifyProductOwnership(
      this.prisma,
      id,
      user.sub,
      ProductMapperUtil.STORE_INFO_WITH_USER_ID_SELECT,
    );
    assertActAsStore(user, owned.storeId);

    // 후기 정보 포함하여 조회
    const productWithReviews = await this.prisma.product.findUnique({
      where: { id },
      include: {
        reviews: ProductMapperUtil.REVIEWS_INCLUDE_FOR_STATS,
        store: {
          select: ProductMapperUtil.STORE_INFO_WITH_USER_ID_SELECT,
        },
      },
    });

    if (!productWithReviews) {
      LoggerUtil.log(`상품 상세 조회 실패: 상품 없음 - productId: ${id}, userId: ${user.sub}`);
      throw new NotFoundException(PRODUCT_ERROR_MESSAGES.NOT_FOUND);
    }

    let isLiked: boolean | null = null;
    try {
      isLiked = await this.likeProductDetailService.isProductLiked(user.sub, id);
    } catch (error: unknown) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      isLiked = null;
    }

    return ProductMapperUtil.mapToProductResponse(productWithReviews, isLiked, "full", "seller");
  }
}
