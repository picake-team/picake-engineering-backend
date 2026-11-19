import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { UpdateProductRequestDto } from "@apps/backend/modules/product/dto/product-update.dto";
import {
  PRODUCT_ERROR_MESSAGES,
  ProductOrderMethod,
  ProductType,
} from "@apps/backend/modules/product/constants/product.constants";
import {
  canonicalJson,
  deriveLegacyOptionFields,
  hasVisibleOption,
  normalizeCustomOptionsForSave,
  parseCustomOptions,
} from "@apps/backend/modules/product/utils/product-custom-option.util";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { ProductOwnershipUtil } from "@apps/backend/modules/product/utils/product-ownership.util";
import { validateProductPrices } from "@apps/backend/modules/product/utils/product-price.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";
import { assertActAsStore } from "@apps/backend/modules/act-as/utils/act-as-scope.util";
import { SELLER_CHECK_SAVE_PATTERN } from "@apps/backend/modules/product-naver/utils/product-ai-draft.util";
import { resolveProductOrderMethod } from "@apps/backend/modules/product/utils/product-order-method.util";

@Injectable()
export class ProductUpdateService {
  constructor(private readonly prisma: PrismaService) {}

  private isOptionWithId(value: unknown): value is Record<string, unknown> & { id: string } {
    return Boolean(
      value &&
      typeof value === "object" &&
      "id" in value &&
      typeof (value as { id: unknown }).id === "string",
    );
  }

  /**
   * 케이크 옵션용 랜덤 ID 생성
   * - 생성 시 한 번만 부여되고 이후에는 변경되지 않도록 사용
   */
  private generateOptionId(prefix: "size"): string {
    const random = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${random}`;
  }

  /**
   * 케이크 옵션에 ID 부여 (기존 ID 유지, 새 옵션에는 새 ID 생성)
   */
  private processCakeOptionsWithIds(
    existingOptions: unknown[],
    newOptions: Array<{ id?: string }>,
    prefix: "size",
  ): Array<{ id: string }> {
    const existingOptionsById = new Map<string, Record<string, unknown> & { id: string }>();

    for (const option of existingOptions) {
      if (this.isOptionWithId(option)) {
        existingOptionsById.set(option.id, option);
      }
    }

    return newOptions.map((option) => {
      const existing =
        option.id && existingOptionsById.has(option.id)
          ? existingOptionsById.get(option.id)
          : undefined;

      const id = existing?.id ?? option.id ?? this.generateOptionId(prefix);

      return {
        ...existing,
        ...option,
        id,
      };
    });
  }

  /**
   * 상품 수정 (판매자용)
   */
  async updateProductForSeller(
    id: string,
    updateProductDto: UpdateProductRequestDto,
    user: JwtVerifiedPayload,
  ) {
    // 상품 소유권 확인
    const owned = await ProductOwnershipUtil.verifyProductOwnership(this.prisma, id, user.sub, {
      sellerId: true,
    });
    assertActAsStore(user, owned.storeId);
    // 손님에게 보이기는 사장님만 바꾼다(기획 I-41 운영자 결정 "숨김 저장, 사장님이 켜기").
    // 수정 화면은 지금 값을 늘 같이 보내므로 같으면 통과한다
    if (
      user.actor &&
      updateProductDto.visibilityStatus !== undefined &&
      updateProductDto.visibilityStatus !== owned.visibilityStatus
    ) {
      throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.VISIBILITY_OWNER_ONLY);
    }

    // 기존 상품 정보 조회 (옵션 업데이트를 위해 필요)
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        originalPrice: true,
        salePrice: true,
        cakeSizeOptions: true,
        customOptions: true,
        productType: true,
        orderMethod: true,
      },
    });

    const nextOriginalPrice = updateProductDto.originalPrice ?? product!.originalPrice;
    const nextSalePrice = updateProductDto.salePrice ?? product!.salePrice;

    validateProductPrices(nextOriginalPrice, nextSalePrice);

    const updateData: Prisma.ProductUpdateInput = {};
    // 판매가·사이즈·맛·추가 옵션 중 하나라도 실제로 바뀌면 optionsVersion을 올린다
    let optionsChanged = false;

    if (updateProductDto.name !== undefined) {
      updateData.name = updateProductDto.name;
    }
    if (updateProductDto.images !== undefined) {
      updateData.images = updateProductDto.images;
    }
    if (updateProductDto.originalPrice !== undefined) {
      updateData.originalPrice = updateProductDto.originalPrice;
    }
    if (updateProductDto.salePrice !== undefined) {
      updateData.salePrice = updateProductDto.salePrice;
      // 판매가가 바뀌어도 버전을 올린다 — 예약 창을 연 손님이 옛 가격으로 보내면 "총 금액이 올바르지 않아요"만 반복되고
      // 다시 받을 길이 없었다(버전이 오르면 409로 상품을 다시 받아 고르게 함, P-04, 11-16 검토)
      optionsChanged ||= updateProductDto.salePrice !== product!.salePrice;
    }
    if (updateProductDto.salesStatus !== undefined) {
      updateData.salesStatus = updateProductDto.salesStatus;
    }
    if (updateProductDto.visibilityStatus !== undefined) {
      updateData.visibilityStatus = updateProductDto.visibilityStatus;
    }
    if (updateProductDto.cakeSizeOptions !== undefined) {
      const existingSizeOptions = Array.isArray(product?.cakeSizeOptions)
        ? product.cakeSizeOptions
        : [];
      const nextSizeOptions = this.processCakeOptionsWithIds(
        existingSizeOptions,
        updateProductDto.cakeSizeOptions ?? [],
        "size",
      );

      if (!hasVisibleOption(nextSizeOptions)) {
        throw new BadRequestException(PRODUCT_ERROR_MESSAGES.SIZE_OPTION_REQUIRED);
      }
      optionsChanged ||= canonicalJson(nextSizeOptions) !== canonicalJson(existingSizeOptions);
      updateData.cakeSizeOptions = nextSizeOptions as unknown as Prisma.InputJsonValue;
    }

    if (updateProductDto.customOptions !== undefined) {
      const nextCustomOptions = normalizeCustomOptionsForSave(
        updateProductDto.customOptions,
        product!.customOptions,
      );
      optionsChanged ||=
        canonicalJson(nextCustomOptions) !==
        canonicalJson(parseCustomOptions(product!.customOptions));
      updateData.customOptions = nextCustomOptions as unknown as Prisma.InputJsonValue;
      Object.assign(updateData, deriveLegacyOptionFields(nextCustomOptions));
    }
    if (optionsChanged) {
      updateData.optionsVersion = { increment: 1 };
    }
    if (updateProductDto.productType !== undefined) {
      updateData.productType = updateProductDto.productType;
    }
    // 주문 받는 방법: 견적 받기는 커스텀 케이크만. 기본 케이크로 바꾸면 예약 받기로 돌린다(기획 I-01 2026-11-19).
    // 이미 받은 예약·견적 요청은 그대로 이어진다(바꾼 뒤 새로 오는 손님만 새 버튼을 봄)
    if (updateProductDto.productType !== undefined || updateProductDto.orderMethod !== undefined) {
      const nextOrderMethod = resolveProductOrderMethod({
        productType: (updateProductDto.productType ?? product!.productType) as ProductType,
        requested: updateProductDto.orderMethod,
        current: product!.orderMethod as ProductOrderMethod,
      });
      if (nextOrderMethod !== product!.orderMethod) {
        updateData.orderMethod = nextOrderMethod;
      }
    }
    // 사장님이 고른 그대로(11-15부터 레터링도 직접 고르는 디자인 값. 상품 유형과 묶지 않는다)
    if (updateProductDto.productCategoryTypes !== undefined) {
      updateData.productCategoryTypes = updateProductDto.productCategoryTypes;
    }
    if (updateProductDto.detailDescription !== undefined) {
      // 화면에서만 막던 것을 서버에서도(옛 앱·API 직접 호출, 11-18 검토)
      if (SELLER_CHECK_SAVE_PATTERN.test(updateProductDto.detailDescription)) {
        throw new BadRequestException(PRODUCT_ERROR_MESSAGES.SELLER_CHECK_LEFT);
      }
      updateData.detailDescription = updateProductDto.detailDescription;
    }
    if (updateProductDto.searchTags !== undefined) {
      updateData.searchTags = updateProductDto.searchTags;
    }
    if (updateProductDto.productNoticeFoodType !== undefined) {
      updateData.productNoticeFoodType = updateProductDto.productNoticeFoodType;
    }
    if (updateProductDto.productNoticeProducer !== undefined) {
      updateData.productNoticeProducer = updateProductDto.productNoticeProducer;
    }
    if (updateProductDto.productNoticeOrigin !== undefined) {
      updateData.productNoticeOrigin = updateProductDto.productNoticeOrigin;
    }
    if (updateProductDto.productNoticeAddress !== undefined) {
      updateData.productNoticeAddress = updateProductDto.productNoticeAddress;
    }
    if (updateProductDto.productNoticeManufactureDate !== undefined) {
      updateData.productNoticeManufactureDate = updateProductDto.productNoticeManufactureDate;
    }
    if (updateProductDto.productNoticeExpirationDate !== undefined) {
      updateData.productNoticeExpirationDate = updateProductDto.productNoticeExpirationDate;
    }
    if (updateProductDto.productNoticePackageCapacity !== undefined) {
      updateData.productNoticePackageCapacity = updateProductDto.productNoticePackageCapacity;
    }
    if (updateProductDto.productNoticePackageQuantity !== undefined) {
      updateData.productNoticePackageQuantity = updateProductDto.productNoticePackageQuantity;
    }
    if (updateProductDto.productNoticeIngredients !== undefined) {
      updateData.productNoticeIngredients = updateProductDto.productNoticeIngredients;
    }
    if (updateProductDto.productNoticeCalories !== undefined) {
      updateData.productNoticeCalories = updateProductDto.productNoticeCalories;
    }
    if (updateProductDto.productNoticeSafetyNotice !== undefined) {
      updateData.productNoticeSafetyNotice = updateProductDto.productNoticeSafetyNotice;
    }
    if (updateProductDto.productNoticeGmoNotice !== undefined) {
      updateData.productNoticeGmoNotice = updateProductDto.productNoticeGmoNotice;
    }
    if (updateProductDto.productNoticeImportNotice !== undefined) {
      updateData.productNoticeImportNotice = updateProductDto.productNoticeImportNotice;
    }
    if (updateProductDto.productNoticeCustomerService !== undefined) {
      updateData.productNoticeCustomerService = updateProductDto.productNoticeCustomerService;
    }

    try {
      const updatedProduct = await this.prisma.product.update({
        where: {
          id,
        },
        data: updateData,
      });

      return {
        id: updatedProduct.id,
      };
    } catch (error: unknown) {
      LoggerUtil.log(
        `상품 수정 실패: 트랜잭션 에러 - userId: ${user.sub}, productId: ${id}, error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
