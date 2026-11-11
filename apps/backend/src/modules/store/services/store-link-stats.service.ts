import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { OrderEntrySource } from "@apps/backend/infra/database/prisma/generated/client";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { STORE_ERROR_MESSAGES } from "@apps/backend/modules/store/constants/store.constants";
import { StoreOwnershipUtil } from "@apps/backend/modules/store/utils/store-ownership.util";
import { StoreLinkStatsResponseDto } from "@apps/backend/modules/store/dto/store-link-stats.dto";

/** 링크 효과를 세는 기간(일) */
export const STORE_LINK_STATS_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 링크 효과(기획 I-45)
 *
 * 사장님이 판매자 앱 "손님에게 링크 보내기"로 보낸 가게·상품 주소에는 `?from=link`가 붙는다.
 * 손님 웹이 그 주소로 열리면 기기 임의 값으로 방문을 남기고(미리보기를 만드는 프로그램은 화면을 실행하지 않아 남지 않는다),
 * 그 가게에 예약하면 주문에 entrySource=STORE_LINK를 붙인다. 사장님은 최근 30일 숫자를 본다.
 */
@Injectable()
export class StoreLinkStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 링크로 들어온 기기를 남긴다. 같은 기기는 가게마다 한 줄이고 마지막 방문 시각만 바꾼다 */
  async recordVisit(storeId: string, visitorKey: string): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException(STORE_ERROR_MESSAGES.NOT_FOUND);

    const now = new Date();
    await this.prisma.storeLinkVisit.upsert({
      where: { storeId_visitorKey: { storeId, visitorKey } },
      create: { storeId, visitorKey, firstVisitedAt: now, lastVisitedAt: now },
      update: { lastVisitedAt: now },
    });
  }

  /** 내 가게의 최근 30일 링크 효과 */
  async getStatsForSeller(
    storeId: string,
    user: JwtVerifiedPayload,
    now: Date = new Date(),
  ): Promise<StoreLinkStatsResponseDto> {
    await StoreOwnershipUtil.verifyStoreOwnership(this.prisma, storeId, user.sub);

    const since = new Date(now.getTime() - STORE_LINK_STATS_DAYS * DAY_MS);
    const [visitorCount, reservationCount] = await Promise.all([
      this.prisma.storeLinkVisit.count({ where: { storeId, lastVisitedAt: { gte: since } } }),
      this.prisma.order.count({
        where: { storeId, entrySource: OrderEntrySource.STORE_LINK, createdAt: { gte: since } },
      }),
    ]);

    return { days: STORE_LINK_STATS_DAYS, visitorCount, reservationCount };
  }
}
