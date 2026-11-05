import { Module } from "@nestjs/common";
import { NaverPlaceService } from "@apps/backend/modules/naver-place/naver-place.service";
import { NaverBookingService } from "@apps/backend/modules/naver-place/naver-booking.service";

/**
 * 네이버 플레이스 매장 정보·네이버 예약 상품 조회 모듈
 */
@Module({
  providers: [NaverPlaceService, NaverBookingService],
  exports: [NaverPlaceService, NaverBookingService],
})
export class NaverPlaceModule {}
