import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { Injectable } from "@nestjs/common";
import { OrderService } from "@apps/backend/modules/order/order.service";
import { NotificationService } from "@apps/backend/modules/notification/services/notification.service";
import { FeedService } from "@apps/backend/modules/feed/feed.service";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { OrderListRequestDto } from "@apps/backend/modules/order/dto/order-list.dto";
import { OrderSortBy } from "@apps/backend/modules/order/constants/order.constants";
import { PaginationRequestDto } from "@apps/backend/common/dto/pagination-request.dto";
import { SellerHomeDashboardResponseDto } from "./dto/seller-home-dashboard.dto";
import { getSeoulTodayYmd } from "./utils/seller-home-date.util";
import {
  SELLER_HOME_FEED_LIMIT,
  SELLER_HOME_NOTIFICATION_LIMIT,
  SELLER_HOME_RECENT_ORDER_LIMIT,
  SELLER_HOME_TODAY_PICKUP_FETCH_LIMIT,
} from "./constants/seller-home.constants";

/**
 * 스토어 홈 대시보드용 데이터를 기존 주문·알림·피드 서비스로 묶어서 조회한다.
 * 스토어 권한 검증은 각 하위 서비스(`getOrdersForSeller` 등)에 위임한다.
 */
/** 홈 "오늘 픽업 예정"에서 빼는 취소 상태(휴대폰 홈 CANCELED_ORDER_STATUSES와 같음) */
const HOME_CANCELED_STATUSES: ReadonlySet<string> = new Set([
  OrderStatus.CANCEL_COMPLETED,
  OrderStatus.CANCEL_REFUND_PENDING,
  OrderStatus.CANCEL_REFUND_COMPLETED,
]);

@Injectable()
export class SellerHomeService {
  constructor(
    private readonly orderService: OrderService,
    private readonly notificationService: NotificationService,
    private readonly feedService: FeedService,
  ) {}

  /** 단일 스토어 기준 홈 패널에 필요한 요약 데이터를 한 번에 반환한다. */
  async getDashboard(
    storeId: string,
    user: JwtVerifiedPayload,
  ): Promise<SellerHomeDashboardResponseDto> {
    const todayYmd = getSeoulTodayYmd();

    // 최근 접수 순 상위 N건
    const recentQuery: OrderListRequestDto = {
      page: 1,
      limit: SELLER_HOME_RECENT_ORDER_LIMIT,
      sortBy: OrderSortBy.LATEST,
      storeId,
    };

    // 픽업 예정일이 오늘(서울 기준 YMD)인 주문만, 픽업 가까운 순으로 받는다(최신 접수순으로 받아 자르면
    // 취소 포함 50건을 넘을 때 먼저 접수한 오늘 픽업이 빠졌다, 11-16 검토)
    const todayPickupQuery: OrderListRequestDto = {
      page: 1,
      limit: SELLER_HOME_TODAY_PICKUP_FETCH_LIMIT,
      sortBy: OrderSortBy.PICKUP_ASC,
      storeId,
      pickupStartDate: todayYmd,
      pickupEndDate: todayYmd,
    };

    const feedQuery: PaginationRequestDto = {
      page: 1,
      limit: SELLER_HOME_FEED_LIMIT,
    };

    // 주문·알림·피드를 병렬로 조회해 홈 응답 지연을 줄인다.
    const [recentOrdersRes, todayPickupsRes, notificationsRes, feedsRes] = await Promise.all([
      this.orderService.getOrdersForSeller(recentQuery, user),
      this.orderService.getOrdersForSeller(todayPickupQuery, user),
      this.notificationService.listSellerWebForStore({
        userId: user.sub,
        storeId,
        unreadOnly: false,
        page: 1,
        limit: SELLER_HOME_NOTIFICATION_LIMIT,
      }),
      this.feedService.getFeedsByStoreIdForSeller(storeId, user, feedQuery),
    ]);

    // 취소된 주문은 "오늘 픽업 예정"에서 뺀다 — 휴대폰 홈과 같게(손님 취소·입금 마감 자동 취소가 "취소완료"로 남던 것)
    const todayPickupsSorted = [...todayPickupsRes.data]
      .filter((o) => o.pickupDate != null && !HOME_CANCELED_STATUSES.has(o.orderStatus))
      .sort((a, b) => {
        const ta = new Date(a.pickupDate).getTime();
        const tb = new Date(b.pickupDate).getTime();
        return ta - tb;
      });

    return {
      recentOrders: recentOrdersRes.data,
      todayPickups: todayPickupsSorted,
      recentNotifications: notificationsRes.items,
      recentFeeds: feedsRes.data,
    };
  }
}
