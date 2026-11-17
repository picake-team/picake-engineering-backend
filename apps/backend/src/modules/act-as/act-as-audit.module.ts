import { Global, Module } from "@nestjs/common";
import { ActAsAuditService } from "@apps/backend/modules/act-as/services/act-as-audit.service";

/**
 * 운영자 대신 입력(기획 I-41) 요청 기록. 전역 모듈이라 `AuthGuard`(막힌 요청)와 전역 인터셉터(나머지)가
 * 어느 모듈에서든 같은 기록 서비스를 쓴다. Prisma만 쓰므로 인증 모듈과 서로 물리지 않는다.
 */
@Global()
@Module({
  providers: [ActAsAuditService],
  exports: [ActAsAuditService],
})
export class ActAsAuditModule {}
