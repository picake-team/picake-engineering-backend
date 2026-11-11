import { Module } from "@nestjs/common";
import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";

/** 운영자 실시간 알림(기획 I-56) */
@Module({
  providers: [OpsAlertService],
  exports: [OpsAlertService],
})
export class OpsAlertModule {}
