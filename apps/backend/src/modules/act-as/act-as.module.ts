import { Module } from "@nestjs/common";
import { AuthModule } from "@apps/backend/modules/auth/auth.module";
import { OpsAlertModule } from "@apps/backend/modules/ops-alert/ops-alert.module";
import { ActAsSessionService } from "@apps/backend/modules/act-as/services/act-as-session.service";

/** 운영자가 가게 대신 입력하는 짧은 접속(기획 I-41): 시작·바꾸기·끝내기·기록 보기 */
@Module({
  imports: [AuthModule, OpsAlertModule],
  providers: [ActAsSessionService],
  exports: [ActAsSessionService],
})
export class ActAsModule {}
