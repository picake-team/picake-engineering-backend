import { describe, expect, it } from "vitest";

import {
  actAsRouteTemplate,
  buildActAsActionRecord,
  summarizeActAsActions,
} from "@apps/backend/modules/act-as/utils/act-as-audit.util";

describe("운영자 대신 입력 기록 한 줄(기획 I-41)", () => {
  it("경로 틀에서 /v1을 빼고, 틀을 모르면 쿼리를 뺀 주소", () => {
    expect(actAsRouteTemplate({ method: "GET", route: { path: "/v1/seller/products/:id" } })).toBe(
      "/seller/products/:id",
    );
    expect(
      actAsRouteTemplate({ method: "GET", originalUrl: "/v1/seller/orders?customerName=홍길순" }),
    ).toBe("/seller/orders");
  });

  it("보낸 칸 이름만 남기고 값은 남기지 않는다", () => {
    const rec = buildActAsActionRecord({
      method: "POST",
      route: { path: "/v1/seller/stores/:storeId/manual-orders/read" },
      params: { storeId: "st_1" },
      body: { image: "data:image/png;base64,AAAA", today: "2026-12-01" },
    });
    expect(rec).toEqual({
      method: "POST",
      route: "/seller/stores/:storeId/manual-orders/read",
      targetId: "st_1",
      fields: ["image", "today"],
    });
    expect(JSON.stringify(rec)).not.toContain("base64");
  });

  it("대상은 좁은 id부터, 새로 만든 것은 응답 id", () => {
    expect(
      buildActAsActionRecord({
        method: "PUT",
        route: { path: "/v1/seller/stores/:storeId/manual-orders/:id" },
        params: { storeId: "st_1", id: "mo_1" },
      }).targetId,
    ).toBe("mo_1");
    expect(
      buildActAsActionRecord(
        { method: "POST", route: { path: "/v1/seller/products" }, body: { storeId: "st_1" } },
        { id: "pr_new" },
      ).targetId,
    ).toBe("pr_new");
    // GET에는 칸 이름이 없다
    expect(
      buildActAsActionRecord({
        method: "GET",
        route: { path: "/v1/seller/products" },
        body: { a: 1 },
      }).fields,
    ).toEqual([]);
  });

  it("요약은 성공한 쓰기만 묶음별로, 본 화면·막힌 요청은 따로", () => {
    expect(
      summarizeActAsActions([
        { method: "POST", route: "/seller/products", status: 201 },
        {
          method: "POST",
          route: "/seller/store/:storeId/naver-products/:itemKey/images",
          status: 200,
        },
        { method: "POST", route: "/seller/products", status: 400 },
        { method: "POST", route: "/seller/stores/:storeId/manual-orders", status: 201 },
        { method: "PUT", route: "/seller/store/:id/business-calendar", status: 200 },
        { method: "PUT", route: "/seller/store/:id", status: 200 },
        { method: "GET", route: "/seller/orders", status: 200 },
        { method: "PUT", route: "/seller/store/:id", status: 403 },
        { method: "POST", route: "/seller/mypage/withdraw", status: 403 },
      ]),
    ).toEqual({ product: 2, manualOrder: 1, calendar: 1, store: 1, view: 1, blocked: 2 });
  });

  it("주소에 스토어가 있어도 새로 만든 주문은 응답 id를 남긴다", () => {
    expect(
      buildActAsActionRecord(
        {
          method: "POST",
          route: { path: "/v1/seller/stores/:storeId/manual-orders" },
          params: { storeId: "st_1" },
          body: { pickupDate: "2026-12-24" },
        },
        { id: "mo_new" },
      ).targetId,
    ).toBe("mo_new");
  });

  it("들어오기·끝내기는 요약에서 빼고, 캡처 읽기는 본 것으로 센다", () => {
    expect(
      summarizeActAsActions([
        { method: "POST", route: "/seller/act-as/exchange", status: 200 },
        { method: "GET", route: "/seller/act-as/me", status: 200 },
        { method: "POST", route: "/seller/act-as/end", status: 200 },
        { method: "POST", route: "/seller/stores/:storeId/manual-orders/read", status: 200 },
      ]),
    ).toEqual({ product: 0, manualOrder: 0, calendar: 0, store: 0, view: 1, blocked: 0 });
  });
});
