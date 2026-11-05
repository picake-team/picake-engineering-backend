import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { StoreOwnershipUtil } from "@apps/backend/modules/store/utils/store-ownership.util";
import { NaverPlaceService } from "@apps/backend/modules/naver-place/naver-place.service";
import { NaverBookingService } from "@apps/backend/modules/naver-place/naver-booking.service";
import { UploadService } from "@apps/backend/modules/upload/upload.service";
import {
  NAVER_BOOKING_ERROR_MESSAGES,
  NAVER_PRODUCT_WARNINGS,
} from "@apps/backend/modules/naver-place/constants/naver-booking.constants";
import {
  NaverBookingItem,
  NaverBookingOption,
  toNaverImageUrl,
} from "@apps/backend/modules/naver-place/utils/naver-booking-parser.util";
import {
  NaverProductSuggestion,
  toNaverOptionProductSuggestion,
  toNaverProductSuggestion,
} from "@apps/backend/modules/naver-place/utils/naver-product-suggestion.util";
import type { NaverPlaceInfo } from "@apps/backend/modules/naver-place/utils/naver-place-parser.util";
import {
  NAVER_OPTION_ITEM_KEY_REGEX,
  NAVER_PRODUCT_ITEM_KEY_REGEX,
  NAVER_PRODUCT_SUMMARY_LENGTH,
  PRODUCT_NAVER_ERROR_MESSAGES,
} from "@apps/backend/modules/product-naver/constants/product-naver.constants";
import {
  ImportNaverImagesResponseDto,
  NaverProductDetailResponseDto,
  NaverProductListResponseDto,
  NaverProductSource,
} from "@apps/backend/modules/product-naver/dto/product-naver.dto";
import { parseMenuPrice } from "@apps/backend/modules/product-naver/utils/naver-menu-price.util";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type ResolvedItem = {
  source: NaverProductSource;
  item: NaverBookingItem;
  /** 옵션 하나를 상품으로 가져올 때의 옵션 (itemKey가 "상품ID-o옵션ID") */
  option: NaverBookingOption | null;
  /** 이 상품(또는 옵션)으로 가져올 수 있는 사진 */
  imageUrls: string[];
  fetchedAt: Date;
  businessId: string | null;
  businessTypeId: number | null;
};

/**
 * 네이버 상품 가져오기 서비스
 *
 * 스토어에 연결한 네이버 매장에서 상품을 읽어 상품 등록·수정 화면에 채울 제안값을 만든다.
 * 저장은 하지 않는다(판매자가 고른 값을 상품 등록·수정 버튼으로 저장한다).
 * 네이버 예약을 쓰는 매장은 예약 상품·옵션을, 아니면 플레이스 메뉴(이름·가격·설명·사진)를 읽는다.
 */
@Injectable()
export class ProductNaverImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly naverPlaceService: NaverPlaceService,
    private readonly naverBookingService: NaverBookingService,
    private readonly uploadService: UploadService,
  ) {}

  /** 연결한 네이버 매장의 상품 목록 */
  async listForSeller(
    storeId: string,
    user: JwtVerifiedPayload,
  ): Promise<NaverProductListResponseDto> {
    const place = await this.getConnectedPlace(storeId, user);

    if (place.info.bookingBusinessId) {
      const { items, fetchedAt } = await this.naverBookingService.listItems(
        place.info.bookingBusinessId,
      );
      const linked = await this.findLinkedProducts(
        storeId,
        items.map((i) => i.bizItemId),
      );
      return {
        source: NaverProductSource.BOOKING,
        fetchedAt: fetchedAt.toISOString(),
        items: items.map((i) => ({
          itemKey: i.bizItemId,
          source: NaverProductSource.BOOKING,
          name: i.name,
          summary: this.summarize(i.desc),
          priceText: null,
          imageUrl: i.imageUrls[0] ?? null,
          isClosed: i.isClosed,
          linkedProduct: linked.get(i.bizItemId) ?? null,
        })),
        warnings: [],
      };
    }

    return {
      source: NaverProductSource.MENU,
      fetchedAt: place.fetchedAt.toISOString(),
      items: place.info.menus.map((m, index) => ({
        itemKey: `menu-${index}`,
        source: NaverProductSource.MENU,
        name: m.name,
        summary: this.summarize(m.description),
        priceText: m.price,
        imageUrl: toNaverImageUrl(m.imageUrl),
        isClosed: false,
        linkedProduct: null,
      })),
      warnings: [NAVER_PRODUCT_WARNINGS.NO_BOOKING],
    };
  }

  /** 상품 1개의 등록 제안값 (예약 상품은 옵션까지) */
  async detailForSeller(
    storeId: string,
    itemKey: string,
    user: JwtVerifiedPayload,
  ): Promise<NaverProductDetailResponseDto> {
    const resolved = await this.resolveItem(storeId, itemKey, user);
    const { item, source } = resolved;

    let suggestion: NaverProductSuggestion;
    if (resolved.option) {
      suggestion = toNaverOptionProductSuggestion(item, resolved.option);
    } else if (source === NaverProductSource.BOOKING) {
      const result = await this.naverBookingService.getItemOptions(
        resolved.businessId as string,
        item.bizItemId,
        resolved.businessTypeId,
      );
      suggestion = toNaverProductSuggestion(item, result.options, result.status);
    } else {
      const base = toNaverProductSuggestion(item, []);
      suggestion = {
        ...base,
        warnings: [
          NAVER_PRODUCT_WARNINGS.NO_BOOKING,
          ...base.warnings.filter((w) => w !== NAVER_PRODUCT_WARNINGS.NO_OPTIONS),
        ],
      };
    }

    // 이미 연결한 Picake 상품 (이 상품, 그리고 옵션을 하나씩 가져온 상품)
    const optionKeys = suggestion.options.map((o) => `${item.bizItemId}-o${o.optionId}`);
    const linkedMap =
      source === NaverProductSource.BOOKING
        ? await this.findLinkedProducts(storeId, [itemKey, ...optionKeys])
        : new Map<string, { id: string; name: string }>();

    return {
      itemKey,
      source,
      fetchedAt: resolved.fetchedAt.toISOString(),
      name: suggestion.name,
      description: suggestion.description,
      precautions: suggestion.precautions,
      imageUrls: suggestion.imageUrls,
      options: suggestion.options.map((o, i) => ({
        ...o,
        linkedProduct: linkedMap.get(optionKeys[i]) ?? null,
      })),
      menuLike: suggestion.menuLike,
      suggestedSalePrice: suggestion.suggestedSalePrice,
      isClosed: suggestion.isClosed,
      soldOutOptionNames: suggestion.soldOutOptionNames,
      linkedProduct: linkedMap.get(itemKey) ?? null,
      warnings: suggestion.warnings,
    };
  }

  /**
   * 판매자가 고른 네이버 사진을 Picake 저장소로 옮긴다.
   * 사진 주소는 판매자가 보내지 않고, 서버가 네이버에서 다시 읽은 상품 사진 중 순번으로 고른다.
   */
  async importImagesForSeller(
    storeId: string,
    itemKey: string,
    indexes: number[],
    user: JwtVerifiedPayload,
  ): Promise<ImportNaverImagesResponseDto> {
    const { imageUrls } = await this.resolveItem(storeId, itemKey, user);
    const uniqueIndexes = [...new Set(indexes)];

    const urls: string[] = [];
    const failedIndexes: number[] = [];
    for (const index of uniqueIndexes) {
      const imageUrl = imageUrls[index];
      if (!imageUrl) {
        failedIndexes.push(index);
        continue;
      }
      try {
        const { buffer, mimetype } = await this.naverBookingService.downloadImage(imageUrl);
        const ext = IMAGE_EXTENSIONS[mimetype];
        if (!ext) {
          failedIndexes.push(index);
          continue;
        }
        const url = await this.uploadService.uploadFile({
          originalname: `naver-product-${index + 1}.${ext}`,
          mimetype,
          buffer,
        });
        urls.push(url);
      } catch {
        failedIndexes.push(index);
      }
    }

    if (urls.length === 0) {
      throw new BadRequestException(NAVER_BOOKING_ERROR_MESSAGES.IMAGE_FAILED);
    }
    return { urls, failedIndexes };
  }

  /** itemKey로 네이버 상품 1개를 찾는다 (목록은 캐시를 쓴다) */
  async resolveItem(
    storeId: string,
    itemKey: string,
    user: JwtVerifiedPayload,
  ): Promise<ResolvedItem> {
    if (!NAVER_PRODUCT_ITEM_KEY_REGEX.test(itemKey)) {
      throw new BadRequestException(PRODUCT_NAVER_ERROR_MESSAGES.ITEM_KEY_INVALID);
    }
    const place = await this.getConnectedPlace(storeId, user);

    if (itemKey.startsWith("menu-")) {
      const menu = place.info.menus[Number(itemKey.slice("menu-".length))];
      if (!menu) throw new NotFoundException(NAVER_BOOKING_ERROR_MESSAGES.ITEM_NOT_FOUND);
      const imageUrl = toNaverImageUrl(menu.imageUrl);
      return {
        source: NaverProductSource.MENU,
        option: null,
        imageUrls: imageUrl ? [imageUrl] : [],
        fetchedAt: place.fetchedAt,
        businessId: null,
        businessTypeId: null,
        item: {
          bizItemId: itemKey,
          name: menu.name,
          desc: menu.description,
          price: parseMenuPrice(menu.price),
          subType: null,
          requiresOption: false,
          isClosed: false,
          precautions: [],
          imageUrls: imageUrl ? [imageUrl] : [],
        },
      };
    }

    const businessId = place.info.bookingBusinessId;
    if (!businessId) throw new NotFoundException(NAVER_BOOKING_ERROR_MESSAGES.ITEM_NOT_FOUND);
    const optionKey = itemKey.match(NAVER_OPTION_ITEM_KEY_REGEX);
    const bizItemId = optionKey ? optionKey[1] : itemKey;
    const { items, fetchedAt } = await this.naverBookingService.listItems(businessId);
    const item = items.find((i) => i.bizItemId === bizItemId);
    if (!item) throw new NotFoundException(NAVER_BOOKING_ERROR_MESSAGES.ITEM_NOT_FOUND);

    let option: NaverBookingOption | null = null;
    if (optionKey) {
      const result = await this.naverBookingService.getItemOptions(
        businessId,
        bizItemId,
        place.info.bookingBusinessTypeId,
      );
      option = result.options?.find((o) => o.optionId === optionKey[2]) ?? null;
      if (!option) throw new NotFoundException(NAVER_BOOKING_ERROR_MESSAGES.ITEM_NOT_FOUND);
    }
    return {
      source: NaverProductSource.BOOKING,
      item,
      option,
      imageUrls: option?.imageUrl ? [option.imageUrl] : item.imageUrls,
      fetchedAt,
      businessId,
      businessTypeId: place.info.bookingBusinessTypeId,
    };
  }

  private async getConnectedPlace(
    storeId: string,
    user: JwtVerifiedPayload,
  ): Promise<{ info: NaverPlaceInfo; fetchedAt: Date }> {
    const store = await StoreOwnershipUtil.verifyStoreOwnership(this.prisma, storeId, user.sub, {
      naverPlaceId: true,
    });
    if (!store.naverPlaceId) {
      throw new BadRequestException(NAVER_BOOKING_ERROR_MESSAGES.NOT_CONNECTED);
    }
    return await this.naverPlaceService.getPlace(store.naverPlaceId);
  }

  private async findLinkedProducts(
    storeId: string,
    bizItemIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    if (bizItemIds.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { storeId, naverBizItemId: { in: bizItemIds } },
      select: { id: true, name: true, naverBizItemId: true },
    });
    return new Map(
      products
        .filter((p) => p.naverBizItemId)
        .map((p) => [p.naverBizItemId as string, { id: p.id, name: p.name }]),
    );
  }

  private summarize(text: string | null): string | null {
    if (!text) return null;
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > NAVER_PRODUCT_SUMMARY_LENGTH
      ? `${oneLine.slice(0, NAVER_PRODUCT_SUMMARY_LENGTH)}…`
      : oneLine;
  }
}
