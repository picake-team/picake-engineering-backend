import { Module } from "@nestjs/common";
import { DatabaseModule } from "@apps/backend/infra/database/database.module";
import { UploadModule } from "@apps/backend/modules/upload/upload.module";
import { ChatModule } from "@apps/backend/modules/chat/chat.module";
import { FcmModule } from "@apps/backend/modules/fcm/fcm.module";
import { NotificationModule } from "@apps/backend/modules/notification/notification.module";
import { OpsAlertModule } from "@apps/backend/modules/ops-alert/ops-alert.module";
import { SolapiModule } from "@apps/backend/modules/solapi/solapi.module";
import { QuoteRequestCleanupService } from "@apps/backend/modules/quote-request/services/quote-request-cleanup.service";
import { QuoteRequestReadService } from "@apps/backend/modules/quote-request/services/quote-request-read.service";
import { QuoteRequestWriteService } from "@apps/backend/modules/quote-request/services/quote-request-write.service";
import { QuoteRequestOpsAlertService } from "@apps/backend/modules/quote-request/services/quote-request-ops-alert.service";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";
import { QuoteNotifyService } from "@apps/backend/modules/quote-request/services/quote-notify.service";
import { QuoteJobsService } from "@apps/backend/modules/quote-request/services/quote-jobs.service";
import { OrderModule } from "@apps/backend/modules/order/order.module";
import { QuoteReservationService } from "@apps/backend/modules/quote-request/services/quote-reservation.service";

/**
 * 견적 요청 모듈(기획 I-46)
 * 손님이 원하는 케이크를 요청서로 보내면, 근처 가게가 견적을 보내고 손님이 골라 그 가게와 채팅으로 이어진다.
 * ①: 요청서 저장·조회, 손님 요청 닫기, 관리자 목록·상세, 운영자 디스코드 알림.
 * ②(2026-11-12): 가게 견적(견적 링크·판매자 앱 채팅·운영자 대신 적기), 고르기, 견적 알림(앱·알림톡), 마감 배치.
 */
@Module({
  imports: [
    DatabaseModule,
    UploadModule,
    ChatModule,
    FcmModule,
    NotificationModule,
    OpsAlertModule,
    SolapiModule,
    OrderModule,
  ],
  providers: [
    QuoteRequestReadService,
    QuoteReservationService,
    QuoteRequestWriteService,
    QuoteRequestOpsAlertService,
    QuoteRequestCleanupService,
    QuoteService,
    QuoteNotifyService,
    QuoteJobsService,
  ],
  exports: [
    QuoteRequestReadService,
    QuoteReservationService,
    QuoteRequestWriteService,
    QuoteRequestCleanupService,
    QuoteService,
  ],
})
export class QuoteRequestModule {}
