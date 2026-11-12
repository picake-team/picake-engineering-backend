import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
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
export class StoreLinkStatsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  /** 30일 지난 방문 기록 지우기 주기(6시간) */
  private readonly cleanupIntervalMs = 6 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.deleteExpiredVisits();
    this.timer = setInterval(() => void this.deleteExpiredVisits(), this.cleanupIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 숫자는 최근 30일만 쓰므로 그보다 오래된 방문 기록(기기 임의 값)은 지운다(최소 수집, 법무 점검표 23번).
   * 예약에 붙은 "링크로 옴"(orders.entry_source)은 주문 기록이라 그대로 둔다. 실패해도 던지지 않는다.
   * @returns 지운 줄 수
   */
  async deleteExpiredVisits(now: Date = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.storeLinkVisit.deleteMany({
        where: { lastVisitedAt: { lt: new Date(now.getTime() - STORE_LINK_STATS_DAYS * DAY_MS) } },
      });
      if (count > 0) LoggerUtil.log(`[StoreLinkStats] 30일 지난 링크 방문 기록 ${count}줄 지움`);
      return count;
    } catch (e) {
      LoggerUtil.log(
        `[StoreLinkStats] 오래된 링크 방문 기록 지우기 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

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
