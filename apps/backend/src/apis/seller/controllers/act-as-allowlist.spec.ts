import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { ALLOW_ACT_AS_METADATA_KEY } from "@apps/backend/modules/auth/decorators/allow-act-as.decorator";
import { SellerApiModule } from "@apps/backend/apis/seller/seller-api.module";
import { AdminApiModule } from "@apps/backend/apis/admin/admin-api.module";
import { ConsumerApiModule } from "@apps/backend/apis/consumer/consumer-api.module";

/**
 * 운영자 대신 입력(기획 I-41) 허용 목록 표.
 * 판매자 경로를 모두 돌며 `@AllowActAs()`를 붙인 경로가 이 표와 같은지 본다. 판매자 경로를 새로 만들거나
 * 표시를 붙이면 이 테스트가 깨진다 — 대리 출입증으로 열어도 되는지 판단하고 표를 고친다(기본은 막기).
 * 막는 것: 탈퇴·번호·프로필, 채팅(목록·내용·보내기·신고), 주문 상태 바꾸기, 견적, 알림 읽음·설정 바꾸기, 알림 토큰,
 * 캘린더 내보내기 주소, 스토어 만들기·사업자 확인, 피드, 링크 효과.
 */
const EXPECTED_ALLOWED = [
  "GET /seller/auth/me",
  "GET /seller/store/list",
  "GET /seller/store/:id",
  "PUT /seller/store/:id",
  "PUT /seller/store/:id/business-calendar",
  "PUT /seller/store/:id/naver-place",
  "DELETE /seller/store/:id/naver-place",
  "GET /seller/naver-place/preview",
  "GET /seller/store/:storeId/home",
  "GET /seller/products",
  "GET /seller/products/:id",
  "POST /seller/products",
  "PUT /seller/products/:id",
  "DELETE /seller/products/:id",
  "GET /seller/store/:storeId/naver-products",
  "GET /seller/store/:storeId/naver-products/:itemKey",
  "POST /seller/store/:storeId/naver-products/:itemKey/images",
  "PUT /seller/products/:productId/naver-item",
  "DELETE /seller/products/:productId/naver-item",
  "POST /seller/store/:storeId/products/description-draft",
  "POST /seller/uploads/file",
  "GET /seller/stores/:storeId/manual-orders",
  "POST /seller/stores/:storeId/manual-orders",
  "POST /seller/stores/:storeId/manual-orders/read",
  "GET /seller/stores/:storeId/manual-orders/:id",
  "PUT /seller/stores/:storeId/manual-orders/:id",
  "PATCH /seller/stores/:storeId/manual-orders/:id/paid",
  "DELETE /seller/stores/:storeId/manual-orders/:id",
  "GET /seller/orders",
  "GET /seller/orders/:id",
  // 보기만: 판매자 화면이 모든 화면(알림 묶음)·홈에서 부른다(로컬 대리 접속으로 확인, 11-18). 쓰기는 막힘
  "GET /seller/notifications",
  "GET /seller/notifications/unread-count",
  "GET /seller/notifications/preferences",
  "GET /seller/statistics/orders/overview",
  "GET /seller/stores/:storeId/chats/unread",
  "GET /seller/act-as/me",
  "POST /seller/act-as/end",
].sort();

type Ctor = { prototype: object; name: string };

function controllersOf(module: unknown): Ctor[] {
  return (Reflect.getMetadata("controllers", module as object) ?? []) as Ctor[];
}

function join(...parts: string[]): string {
  return `/${parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/")}`;
}

function routesOf(controller: Ctor) {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor" && typeof proto[name] === "function")
    .map((name) => {
      const handler = proto[name] as object;
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (path === undefined || method === undefined) return null;
      return {
        key: `${RequestMethod[method as RequestMethod]} ${join(base, String(path))}`,
        allowed: Reflect.getMetadata(ALLOW_ACT_AS_METADATA_KEY, handler) === true,
      };
    })
    .filter((r): r is { key: string; allowed: boolean } => r !== null);
}

describe("운영자 대신 입력 허용 목록(기획 I-41)", () => {
  it("판매자 경로 가운데 @AllowActAs를 붙인 것이 표와 같다", () => {
    const allowed = controllersOf(SellerApiModule)
      .flatMap(routesOf)
      .filter((r) => r.allowed)
      .map((r) => r.key)
      .sort();
    expect(allowed).toEqual(EXPECTED_ALLOWED);
  });

  it("표시는 경로(메서드)에만 — 컨트롤러 전체를 여는 클래스 표시는 없다", () => {
    for (const c of controllersOf(SellerApiModule)) {
      expect(Reflect.getMetadata(ALLOW_ACT_AS_METADATA_KEY, c), c.name).toBeUndefined();
    }
  });

  it("관리자·손님 경로에는 붙이지 않는다", () => {
    const others = [...controllersOf(AdminApiModule), ...controllersOf(ConsumerApiModule)]
      .flatMap(routesOf)
      .filter((r) => r.allowed);
    expect(others).toEqual([]);
  });
});
