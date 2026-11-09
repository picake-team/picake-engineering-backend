import { Module } from "@nestjs/common";
import { DatabaseModule } from "@apps/backend/infra/database/database.module";
import { QuoteRequestReadService } from "@apps/backend/modules/quote-request/services/quote-request-read.service";
import { QuoteRequestWriteService } from "@apps/backend/modules/quote-request/services/quote-request-write.service";
import { QuoteRequestOpsAlertService } from "@apps/backend/modules/quote-request/services/quote-request-ops-alert.service";

/**
 * 견적 요청 모듈(기획 I-46)
 * 손님이 원하는 케이크를 요청서로 보내면, 운영자가 근처 가게에 물어 견적을 받는다.
 * 1단계 ①: 요청서 저장·조회, 손님 요청 닫기, 관리자 목록·상세, 운영자 디스코드 알림.
 */
@Module({
  imports: [DatabaseModule],
  providers: [QuoteRequestReadService, QuoteRequestWriteService, QuoteRequestOpsAlertService],
  exports: [QuoteRequestReadService, QuoteRequestWriteService],
})
export class QuoteRequestModule {}
