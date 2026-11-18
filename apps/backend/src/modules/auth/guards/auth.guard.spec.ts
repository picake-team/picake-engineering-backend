import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import { AUDIENCE, TOKEN_TYPES } from "@apps/backend/modules/auth/constants/auth.constants";

import { AuthGuard, AuthMetadata } from "./auth.guard";

function buildContext(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function buildGuard(metadata: AuthMetadata | undefined): AuthGuard {
  const reflector = { getAllAndOverride: vi.fn(() => metadata) } as unknown as Reflector;
  return new AuthGuard(reflector);
}

describe("AuthGuard.canActivate", () => {
  it("isPublic 엔드포인트는 인증 없이 통과한다", () => {
    const guard = buildGuard({ isPublic: true });
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it("isOptionalPublic이고 토큰이 없으면 통과한다", () => {
    const guard = buildGuard({ isPublic: false, isOptionalPublic: true });
    expect(guard.canActivate(buildContext())).toBe(true);
  });
});

describe("AuthGuard.handleRequest", () => {
  it("인증 성공 시 user를 그대로 반환한다 (audience/type 제약 없음)", () => {
    const guard = buildGuard({ isPublic: false });
    const user = { aud: AUDIENCE.CONSUMER, type: TOKEN_TYPES.ACCESS };

    expect(guard.handleRequest(null, user, null, buildContext())).toBe(user);
  });

  it("isOptionalPublic 엔드포인트에서 인증 실패는 에러 없이 undefined를 반환한다", () => {
    const guard = buildGuard({ isPublic: false, isOptionalPublic: true });

    const result = guard.handleRequest(new UnauthorizedException(), null, null, buildContext());
    expect(result).toBeUndefined();
  });

  it("토큰이 없으면 ACCESS_TOKEN_MISSING으로 거부한다", () => {
    const guard = buildGuard({ isPublic: false });

    expect(() => guard.handleRequest(null, null, null, buildContext())).toThrow(
      UnauthorizedException,
    );
  });

  it("토큰 만료(TokenExpiredError)는 만료 메시지로 거부한다", () => {
    const guard = buildGuard({ isPublic: false });

    expect(() =>
      guard.handleRequest(
        null,
        null,
        { name: "TokenExpiredError" },
        buildContext({ authorization: "Bearer expired-token" }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("잘못된 토큰(JsonWebTokenError)은 유효하지 않음 메시지로 거부한다", () => {
    const guard = buildGuard({ isPublic: false });

    expect(() =>
      guard.handleRequest(
        null,
        null,
        { name: "JsonWebTokenError" },
        buildContext({ authorization: "Bearer bad-token" }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("허용되지 않은 audience면 ForbiddenException을 던진다", () => {
    const guard = buildGuard({ isPublic: false, audiences: [AUDIENCE.ADMIN] });
    const user = { aud: AUDIENCE.CONSUMER, type: TOKEN_TYPES.ACCESS };

    expect(() => guard.handleRequest(null, user, null, buildContext())).toThrow(ForbiddenException);
  });

  it("허용되지 않은 jwtType이면 ForbiddenException을 던진다", () => {
    const guard = buildGuard({ isPublic: false, jwtTypes: [TOKEN_TYPES.TOTP_PENDING] });
    const user = { aud: AUDIENCE.ADMIN, type: TOKEN_TYPES.ACCESS };

    expect(() => guard.handleRequest(null, user, null, buildContext())).toThrow(ForbiddenException);
  });

  it("jwtTypes를 지정하지 않으면 기본값(access)만 허용한다", () => {
    const guard = buildGuard({ isPublic: false });
    const refreshUser = { aud: AUDIENCE.CONSUMER, type: TOKEN_TYPES.REFRESH };

    expect(() => guard.handleRequest(null, refreshUser, null, buildContext())).toThrow(
      ForbiddenException,
    );
  });
});

/** 운영자 대신 입력 출입증(기획 I-41): 허용 목록·들어간 가게만 */
describe("AuthGuard.handleRequest — 대리 출입증(act_as)", () => {
  const actor = { adminId: "adm_1", sessionId: "sid_1", storeId: "st_1" };
  const actAsUser = { aud: AUDIENCE.SELLER, type: TOKEN_TYPES.ACT_AS, sub: "sel_1", actor };

  function buildActAsGuard(metadata: AuthMetadata, allowActAs: boolean) {
    const reflector = {
      getAllAndOverride: vi.fn(() => metadata),
      get: vi.fn(() => (allowActAs ? true : undefined)),
    } as unknown as Reflector;
    const audit = { record: vi.fn(async () => undefined) };
    return { guard: new AuthGuard(reflector, audit as never), audit };
  }

  function ctx(req: Record<string, unknown> = {}): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, method: "GET", ...req }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  const sellerRoute: AuthMetadata = { isPublic: false, audiences: [AUDIENCE.SELLER] };

  it("@AllowActAs가 없는 판매자 경로는 403이고 기록을 남긴다", () => {
    const { guard, audit } = buildActAsGuard(sellerRoute, false);
    expect(() => guard.handleRequest(null, actAsUser, null, ctx())).toThrow(ForbiddenException);
    expect(audit.record).toHaveBeenCalledWith("sid_1", expect.anything(), 403);
  });

  it("@AllowActAs가 있으면 사장님 출입증처럼 통과한다", () => {
    const { guard } = buildActAsGuard(sellerRoute, true);
    expect(guard.handleRequest(null, actAsUser, null, ctx({ params: { storeId: "st_1" } }))).toBe(
      actAsUser,
    );
  });

  it("다른 스토어(주소·쿼리·본문·/seller/store/:id)는 403", () => {
    const { guard } = buildActAsGuard(sellerRoute, true);
    for (const req of [
      { params: { storeId: "st_2" } },
      { query: { storeId: "st_2" } },
      { body: { storeId: "st_2" } },
      { params: { id: "st_2" }, route: { path: "/v1/seller/store/:id" } },
    ]) {
      expect(() => guard.handleRequest(null, actAsUser, null, ctx(req))).toThrow(
        ForbiddenException,
      );
    }
    // /seller/products/:id의 id는 스토어가 아니다
    expect(
      guard.handleRequest(
        null,
        actAsUser,
        null,
        ctx({ params: { id: "pr_1" }, route: { path: "/v1/seller/products/:id" } }),
      ),
    ).toBe(actAsUser);
  });

  it("대리 출입증 전용 경로(jwtTypes: act_as)는 사장님 출입증을 받지 않는다", () => {
    const meta: AuthMetadata = { ...sellerRoute, jwtTypes: [TOKEN_TYPES.ACT_AS] };
    const { guard } = buildActAsGuard(meta, true);
    expect(guard.handleRequest(null, actAsUser, null, ctx())).toBe(actAsUser);
    expect(() =>
      guard.handleRequest(null, { aud: AUDIENCE.SELLER, type: TOKEN_TYPES.ACCESS }, null, ctx()),
    ).toThrow(ForbiddenException);
  });

  it("손님·관리자 경로는 aud가 달라 403", () => {
    const { guard } = buildActAsGuard({ isPublic: false, audiences: [AUDIENCE.ADMIN] }, true);
    expect(() => guard.handleRequest(null, actAsUser, null, ctx())).toThrow(ForbiddenException);
  });
});
