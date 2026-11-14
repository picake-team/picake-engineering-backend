import { Injectable } from "@nestjs/common";
import { LikeProductCreateService } from "@apps/backend/modules/like/services/like-product-create.service";
import { LikeProductDeleteService } from "@apps/backend/modules/like/services/like-product-delete.service";
import { LikeProductDetailService } from "@apps/backend/modules/like/services/like-product-detail.service";
import { LikeStoreCreateService } from "@apps/backend/modules/like/services/like-store-create.service";
import { LikeStoreDeleteService } from "@apps/backend/modules/like/services/like-store-delete.service";
import { LikeStoreDetailService } from "@apps/backend/modules/like/services/like-store-detail.service";
import { LikeUserListService } from "@apps/backend/modules/like/services/like-user-list.service";
import { LikeDesignCreateService } from "@apps/backend/modules/like/services/like-design-create.service";
import { LikeDesignDeleteService } from "@apps/backend/modules/like/services/like-design-delete.service";
import { LikeDesignListService } from "@apps/backend/modules/like/services/like-design-list.service";
import type { DesignLikesResponseDto } from "@apps/backend/modules/like/dto/like-design.dto";
import {
  GetStoresRequestDto,
  StoreListResponseDto,
} from "@apps/backend/modules/store/dto/store-list.dto";
import {
  GetProductsRequestDto,
  ProductListResponseDto,
} from "@apps/backend/modules/product/dto/product-list.dto";

/**
 * 좋아요 서비스
 *
 * 모든 좋아요 관련 기능을 통합하여 제공하는 메인 서비스입니다.
 * CRUD 서비스들을 조합하여 사용합니다.
 */
@Injectable()
export class LikeService {
  constructor(
    private readonly likeProductCreateService: LikeProductCreateService,
    private readonly likeProductDeleteService: LikeProductDeleteService,
    private readonly likeProductDetailService: LikeProductDetailService,
    private readonly likeStoreCreateService: LikeStoreCreateService,
    private readonly likeStoreDeleteService: LikeStoreDeleteService,
    private readonly likeStoreDetailService: LikeStoreDetailService,
    private readonly likeUserListService: LikeUserListService,
    private readonly likeDesignCreateService: LikeDesignCreateService,
    private readonly likeDesignDeleteService: LikeDesignDeleteService,
    private readonly likeDesignListService: LikeDesignListService,
  ) {}

  /**
   * 상품 좋아요 추가 (사용자용)
   */
  async addProductLikeForUser(userId: string, productId: string) {
    return this.likeProductCreateService.addProductLikeForUser(userId, productId);
  }

  /**
   * 상품 좋아요 삭제 (사용자용)
   */
  async removeProductLikeForUser(userId: string, productId: string) {
    return this.likeProductDeleteService.removeProductLikeForUser(userId, productId);
  }

  /**
   * 스토어 좋아요 추가 (사용자용)
   */
  async addStoreLikeForUser(userId: string, storeId: string) {
    return this.likeStoreCreateService.addStoreLikeForUser(userId, storeId);
  }

  /**
   * 스토어 좋아요 삭제 (사용자용)
   */
  async removeStoreLikeForUser(userId: string, storeId: string) {
    return this.likeStoreDeleteService.removeStoreLikeForUser(userId, storeId);
  }

  /**
   * 내가 좋아요한 스토어 목록 조회 (사용자용)
   */
  async getMyStoreLikesForUser(
    userId: string,
    query: GetStoresRequestDto,
  ): Promise<StoreListResponseDto> {
    return this.likeUserListService.getMyStoreLikesForUser(userId, query);
  }

  /**
   * 내가 좋아요한 상품 목록 조회 (사용자용)
   */
  async getMyProductLikesForUser(
    userId: string,
    query: GetProductsRequestDto,
  ): Promise<ProductListResponseDto> {
    return this.likeUserListService.getMyProductLikesForUser(userId, query);
  }

  /**
   * 디자인 좋아요 추가 (사용자용, 이미 눌렀으면 그대로)
   */
  async addDesignLikeForUser(userId: string, designId: string): Promise<void> {
    return this.likeDesignCreateService.addDesignLikeForUser(userId, designId);
  }

  /**
   * 디자인 좋아요 취소 (사용자용, 누르지 않았어도 그대로)
   */
  async removeDesignLikeForUser(userId: string, designId: string): Promise<void> {
    return this.likeDesignDeleteService.removeDesignLikeForUser(userId, designId);
  }

  /**
   * 디자인별 좋아요 수와 내 좋아요(로그인하지 않았으면 내 좋아요는 [])
   */
  async getDesignLikes(userId?: string): Promise<DesignLikesResponseDto> {
    return this.likeDesignListService.getDesignLikes(userId);
  }
}
