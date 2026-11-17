import { Module } from "@nestjs/common";
import { ManualOrderService } from "@apps/backend/modules/manual-order/services/manual-order.service";
import { ManualOrderReadService } from "@apps/backend/modules/manual-order/services/manual-order-read.service";
import { CalendarFeedService } from "@apps/backend/modules/manual-order/services/calendar-feed.service";

/**
 * 직접 적은 주문(기획 I-42) 모듈: 적기·고치기·지우기, 대화 붙여 넣어 채우기(Claude), 다른 캘린더로 내보내기(ics).
 * HTTP 라우트는 `SellerApiModule`의 `SellerManualOrderController`·`SellerCalendarFeedController`에 둔다.
 */
@Module({
  providers: [ManualOrderService, ManualOrderReadService, CalendarFeedService],
  exports: [ManualOrderService, ManualOrderReadService, CalendarFeedService],
})
export class ManualOrderModule {}
