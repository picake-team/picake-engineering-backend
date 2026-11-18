import {
  Injectable,
  ExecutionContext,
  CanActivate,
  UnauthorizedException,
  ForbiddenException,
  Optional,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Reflector } from "@nestjs/core";
import { AuthGuard as BaseAuthGuard } from "@nestjs/passport";
import {
  AUTH_ERROR_MESSAGES,
  TOKEN_TYPES,
  type AudienceConst,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { ADMIN_API_KEY_HEADER } from "@apps/backend/modules/admin-api-key/constants/admin-api-key.constants";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { ALLOW_ACT_AS_METADATA_KEY } from "@apps/backend/modules/auth/decorators/allow-act-as.decorator";
import type { AuthenticatedUser } from "@apps/backend/modules/auth/types/auth.types";
import { ActAsAuditService } from "@apps/backend/modules/act-as/services/act-as-audit.service";

export const AUTH_METADATA_KEY = "auth";

export interface AuthMetadata {
  isPublic: boolean; // 인증 건너뛰기
  isOptionalPublic?: boolean; // 선택적 인증: 토큰이 있으면 검증하고, 없으면 통과
  audiences?: AudienceConst[];
  jwtTypes?: readonly string[]; // 허용 JWT `type` 클레임. 생략 시 액세스 토큰(`access`)만 허용
}

/**
 * 통합 인증 가드
 * JWT 인증과 역할 기반 권한을 통합하여 처리합니다.
 */
@Injectable()
export class AuthGuard extends BaseAuthGuard(["jwt", "admin-api-key"]) implements CanActivate {
  constructor(
    private reflector: Reflector,
    /** 운영자 대신 입력(기획 I-41) 중 막힌 요청 기록 — 전역 `ActAsAuditModule`. 단위 테스트처럼 없으면 남기지 않는다 */
    @Optional() private readonly actAsAudit?: ActAsAuditService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    // 인증 메타데이터 가져오기
    const authMetadata = this.getAuthMetadata(context);

    // 메타데이터가 없으면 기본 인증 적용
    if (!authMetadata) {
      return super.canActivate(context);
    }

    // OptionalPublic 엔드포인트인 경우 선택적 인증 (토큰이 있으면 검증, 없으면 통과)
    // isPublic과 isOptionalPublic이 모두 true인 경우, OptionalPublic을 우선 처리
    if (authMetadata.isOptionalPublic) {
      // 토큰이 있는지 확인
      const request = context.switchToHttp().getRequest();
      const authHeader = request.headers?.authorization;
      const hasToken = authHeader && authHeader.startsWith("Bearer ");

      // 토큰이 있으면 인증 시도
      if (hasToken) {
        return super.canActivate(context) as Promise<boolean>;
      }

      // 토큰이 없으면 그냥 통과
      return true;
    }

    // Public 엔드포인트인 경우 인증 건너뛰기
    if (authMetadata.isPublic) {
      return true;
    }

    // JWT 인증 수행
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    // 인증 메타데이터 가져오기
    const authMetadata = this.getAuthMetadata(context);

    // OptionalPublic 엔드포인트이고 인증 실패한 경우, 에러를 던지지 않고 undefined 반환
    if (authMetadata?.isOptionalPublic && (err || !user)) {
      // 토큰이 있었지만 검증 실패한 경우 (만료, 잘못된 토큰 등)
      // OptionalPublic 엔드포인트이므로 에러를 던지지 않고 undefined 반환
      return undefined;
    }

    // OptionalPublic이 아닌 엔드포인트이거나 OptionalPublic이지만 인증 성공한 경우
    if (err || !user) {
      // 이미 Nest UnauthorizedException으로 올라온 경우는 그대로 전달
      if (err instanceof UnauthorizedException) {
        LoggerUtil.log(`인증 실패: UnauthorizedException - message: ${err.message || "unknown"}`);
        throw err;
      }

      // 여러 전략(["jwt", "admin-api-key"])을 체이닝하면 passport가 `info`를 각 전략의 실패
      // 사유를 모은 배열로 넘겨준다 (단일 전략일 때는 객체 하나) — 두 경우 모두 처리한다.
      const infoList = Array.isArray(info) ? info : [info];
      // Passport가 전달하는 info는 Error 객체일 수 있음(TokenExpiredError, JsonWebTokenError 등)
      const errorName = infoList.find((i) => i?.name)?.name || err?.name;

      if (errorName === "TokenExpiredError") {
        LoggerUtil.log(`인증 실패: 토큰 만료 - errorName: ${errorName}`);
        throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACCESS_TOKEN_EXPIRED);
      }

      if (errorName === "JsonWebTokenError") {
        LoggerUtil.log(`인증 실패: 잘못된 토큰 - errorName: ${errorName}`);
        throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACCESS_TOKEN_INVALID);
      }

      // 그 외 토큰 누락 등 일반 인증 실패
      // 토큰이 없는 경우 확인
      const request = context.switchToHttp().getRequest();
      const authHeader = request.headers?.authorization;
      const hasToken =
        authHeader && authHeader.startsWith("Bearer ") && authHeader.substring(7).trim();
      const apiKeyHeader = request.headers?.[ADMIN_API_KEY_HEADER];

      if (!hasToken && apiKeyHeader) {
        LoggerUtil.log(`인증 실패: 관리자 API 키 무효`);
        throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ADMIN_API_KEY_INVALID);
      }

      if (!hasToken) {
        LoggerUtil.log(`인증 실패: 토큰 없음`);
        throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACCESS_TOKEN_MISSING);
      }

      // 토큰이 있지만 알 수 없는 에러인 경우
      LoggerUtil.log(`인증 실패: 알 수 없는 에러 - errorName: ${errorName || "unknown"}`);
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACCESS_TOKEN_INVALID);
    }

    if (authMetadata?.audiences && authMetadata.audiences.length > 0) {
      const ok = authMetadata.audiences.includes(user.aud);
      if (!ok) {
        LoggerUtil.log(
          `인증 실패: aud 불일치 - userAud: ${user.aud}, required: ${authMetadata.audiences.join(",")}`,
        );
        // 대리 출입증으로 관리자·손님 경로를 부른 것도 기록에 남긴다(기획 I-41)
        if (user.type === TOKEN_TYPES.ACT_AS) {
          this.recordActAsBlocked(user as AuthenticatedUser, context.switchToHttp().getRequest());
        }
        throw new ForbiddenException(AUTH_ERROR_MESSAGES.AUDIENCE_NOT_AUTHORIZED);
      }
    }

    // 운영자 대신 입력 출입증(기획 I-41): 허용 목록에 넣은 경로·들어간 가게만. 기본은 막는다
    const isActAs = user.type === TOKEN_TYPES.ACT_AS;
    if (isActAs) {
      this.assertActAsAllowed(user as AuthenticatedUser, context);
    }

    if (authMetadata && !authMetadata.isPublic && !authMetadata.isOptionalPublic && user) {
      const allowed = authMetadata.jwtTypes ?? [TOKEN_TYPES.ACCESS];
      // 허용 목록을 지난 대리 출입증은 경로가 따로 정하지 않았으면 사장님 출입증(access)처럼 본다
      const t = isActAs && !authMetadata.jwtTypes ? TOKEN_TYPES.ACCESS : user.type;
      if (!t || !allowed.includes(t)) {
        LoggerUtil.log(
          `인증 실패: JWT type 불허 - type: ${String(t)}, allowed: ${allowed.join(",")}`,
        );
        throw new ForbiddenException(AUTH_ERROR_MESSAGES.JWT_TYPE_NOT_ALLOWED_FOR_ROUTE);
      }
    }

    return user;
  }

  /**
   * 대리 출입증이 이 경로를 쓸 수 있나(기획 I-41).
   * 1) 경로(메서드)에 `@AllowActAs()`가 있어야 한다 — 클래스 표시는 보지 않는다(새 경로가 저절로 열리지 않게).
   * 2) 주소·쿼리·본문에 스토어 id가 있으면 들어간 가게여야 한다(사장님이 스토어를 여럿 가진 경우).
   * 막으면 기록을 남기고 403.
   */
  private assertActAsAllowed(user: AuthenticatedUser, context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest();
    const allowed =
      this.reflector.get<boolean | undefined>(ALLOW_ACT_AS_METADATA_KEY, context.getHandler()) ===
      true;
    if (!allowed) {
      this.recordActAsBlocked(user, request);
      LoggerUtil.log(
        `대리 입력 막음: 허용 목록 밖 - ${request.method} ${request.route?.path ?? ""}`,
      );
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACT_AS_ROUTE_BLOCKED);
    }
    const storeId = user.actor?.storeId;
    if (!storeId || actAsStoreIdsInRequest(request).some((id) => id !== storeId)) {
      this.recordActAsBlocked(user, request);
      LoggerUtil.log(
        `대리 입력 막음: 다른 스토어 - ${request.method} ${request.route?.path ?? ""}`,
      );
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACT_AS_OTHER_STORE);
    }
  }

  private recordActAsBlocked(user: AuthenticatedUser, request: unknown): void {
    const sessionId = user.actor?.sessionId;
    if (!sessionId || !this.actAsAudit) return;
    void this.actAsAudit.record(
      sessionId,
      request as Parameters<ActAsAuditService["record"]>[1],
      403,
    );
  }

  /**
   * 인증 메타데이터를 가져오는 헬퍼 메서드
   * 중복 코드를 제거하고 성능을 최적화합니다.
   */
  private getAuthMetadata(context: ExecutionContext): AuthMetadata | undefined {
    return this.reflector.getAllAndOverride<AuthMetadata>(AUTH_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}

/**
 * 요청이 가리키는 스토어 id들(기획 I-41 대리 입력 가게 확인용).
 * 판매자 경로는 스토어를 `:storeId`(주소)·`storeId`(쿼리·본문)로 받고, 스토어 컨트롤러만 `/seller/store/:id`로 받는다.
 */
export function actAsStoreIdsInRequest(request: {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  route?: { path?: string };
}): string[] {
  const ids: unknown[] = [request.params?.storeId, request.query?.storeId];
  if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
    ids.push((request.body as Record<string, unknown>).storeId);
  }
  if (/\/seller\/store\/:id(\/|$)/.test(request.route?.path ?? "")) {
    ids.push(request.params?.id);
  }
  return ids.filter((v): v is string => typeof v === "string" && v.length > 0);
}
