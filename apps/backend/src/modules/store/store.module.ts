import { Module } from "@nestjs/common";
import { StoreService } from "@apps/backend/modules/store/store.service";
import { StoreCreateService } from "@apps/backend/modules/store/services/store-create.service";
import { StoreListService } from "@apps/backend/modules/store/services/store-list.service";
import { StoreUpdateService } from "@apps/backend/modules/store/services/store-update.service";
import { StoreBusinessCalendarService } from "@apps/backend/modules/store/services/store-business-calendar.service";
import { BusinessModule } from "@apps/backend/modules/business/business.module";
import { DatabaseModule } from "@apps/backend/infra/database/database.module";
import { LikeModule } from "@apps/backend/modules/like/like.module";
import { NaverPlaceModule } from "@apps/backend/modules/naver-place/naver-place.module";
import { StoreNaverPlaceService } from "@apps/backend/modules/store/services/store-naver-place.service";

/**
 * 스토어 관련 모듈
 */
@Module({
  imports: [BusinessModule, DatabaseModule, LikeModule, NaverPlaceModule],
  providers: [
    StoreService,
    StoreCreateService,
    StoreListService,
    StoreUpdateService,
    StoreBusinessCalendarService,
    StoreNaverPlaceService,
  ],
  exports: [
    StoreService,
    StoreCreateService,
    StoreUpdateService,
    StoreListService,
    StoreBusinessCalendarService,
    StoreNaverPlaceService,
  ],
})
export class StoreModule {}
