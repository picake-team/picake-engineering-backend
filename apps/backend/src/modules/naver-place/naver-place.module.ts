import { Module } from "@nestjs/common";
import { NaverPlaceService } from "@apps/backend/modules/naver-place/naver-place.service";

/**
 * 네이버 플레이스 매장 정보 조회 모듈
 */
@Module({
  providers: [NaverPlaceService],
  exports: [NaverPlaceService],
})
export class NaverPlaceModule {}
