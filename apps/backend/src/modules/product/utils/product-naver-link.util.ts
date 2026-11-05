import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { NAVER_BOOKING_ERROR_MESSAGES } from "@apps/backend/modules/naver-place/constants/naver-booking.constants";

export const PRODUCT_NAVER_LINK_MESSAGES = {
  ALREADY_LINKED: (productName: string) =>
    `이 네이버 상품은 이미 '${productName}' 상품과 연결돼 있어요. 그 상품에서 다시 불러와 주세요.`,
  ALREADY_LINKED_UNKNOWN: "이 네이버 상품은 이미 다른 상품과 연결돼 있어요.",
};

/**
 * 상품 ↔ 네이버 예약 상품 연결 규칙
 * - 스토어에 네이버 매장이 연결돼 있어야 한다
 * - 네이버 상품 하나는 같은 스토어 안에서 한 상품에만 연결한다 (DB 유니크 제약과 같음)
 */
export class ProductNaverLinkUtil {
  static async assertLinkable(
    prisma: PrismaService,
    storeId: string,
    naverBizItemId: string,
    exceptProductId?: string,
  ): Promise<void> {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { naverPlaceId: true },
    });
    if (!store?.naverPlaceId) {
      throw new BadRequestException(NAVER_BOOKING_ERROR_MESSAGES.NOT_CONNECTED);
    }

    const linked = await prisma.product.findFirst({
      where: {
        storeId,
        naverBizItemId,
        ...(exceptProductId ? { id: { not: exceptProductId } } : {}),
      },
      select: { name: true },
    });
    if (linked) {
      throw new ConflictException(PRODUCT_NAVER_LINK_MESSAGES.ALREADY_LINKED(linked.name));
    }
  }

  static isDuplicateLinkError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return false;
    }
    const target = (error.meta as { target?: unknown } | undefined)?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
    return fields.some((f) => f.includes("naver_biz_item_id") || f.includes("naverBizItemId"));
  }

  static duplicateLinkException(): ConflictException {
    return new ConflictException(PRODUCT_NAVER_LINK_MESSAGES.ALREADY_LINKED_UNKNOWN);
  }
}
