import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import {
  type ActAsAuditRequest,
  buildActAsActionRecord,
} from "@apps/backend/modules/act-as/utils/act-as-audit.util";

/**
 * 운영자 대신 입력(기획 I-41) 중 요청 하나를 남긴다(GET·막힌 요청 포함).
 * 경로 틀·대상 id·보낸 칸 이름·결과만 남기고 보낸 값은 남기지 않는다.
 * 기록이 실패해도 사장님 데이터 일은 이미 끝났으므로 응답은 막지 않고 Sentry에 남긴다.
 */
@Injectable()
export class ActAsAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    sessionId: string,
    req: ActAsAuditRequest,
    status: number,
    responseData?: unknown,
  ): Promise<void> {
    try {
      const rec = buildActAsActionRecord(req, responseData);
      await this.prisma.adminActAsAction.create({
        data: { sessionId, ...rec, status, createdAt: new Date() },
      });
    } catch (e) {
      LoggerUtil.log(
        `[ActAs] 기록 실패 - sid: ${sessionId}, error: ${e instanceof Error ? e.message : String(e)}`,
      );
      // 쓰기(GET이 아닌 요청)의 기록이 빠지면 "한 일은 모두 남는다"(기획 P-93)가 깨진다 — 보기보다 높게 올린다
      const isWrite = !["GET", "HEAD"].includes((req.method ?? "GET").toUpperCase());
      SentryUtil.captureException(e, isWrite ? "error" : "warning", {
        module: "act-as",
        operation: "record",
        write: String(isWrite),
      });
    }
  }
}
