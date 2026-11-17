import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Observable, catchError, concatMap, from, throwError } from "rxjs";
import type { ActAsActor } from "@apps/backend/modules/auth/types/auth.types";
import { ActAsAuditService } from "@apps/backend/modules/act-as/services/act-as-audit.service";

/**
 * 운영자 대신 입력(기획 I-41) 중 요청을 모두 남기는 전역 인터셉터(`app.module.ts`).
 * 인증 뒤 `req.user.actor`가 있는 요청(대리 출입증)만 남기고 사장님 요청은 그대로 지나간다.
 * 성공·실패 모두 남긴다. 허용 목록에서 막힌 요청은 가드가 남긴다(`AuthGuard` — 인터셉터까지 오지 않음).
 */
@Injectable()
export class ActAsAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: ActAsAuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest();
    const actor: ActAsActor | undefined = req.user?.actor;
    if (!actor) return next.handle();

    // 응답 코드는 응답을 보낼 때 정해지므로 경로 표시(@HttpCode)나 Nest 기본값으로 센다
    const okStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === "POST" ? 201 : 200);

    return next.handle().pipe(
      concatMap(async (data: unknown) => {
        await this.audit.record(actor.sessionId, req, okStatus, data);
        return data;
      }),
      catchError((err: unknown) =>
        from(
          this.audit.record(
            actor.sessionId,
            req,
            err instanceof HttpException ? err.getStatus() : 500,
          ),
        ).pipe(concatMap(() => throwError(() => err))),
      ),
    );
  }
}
