import request from "supertest";
import { describe, expect, it } from "vitest";

import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { getTestApp } from "@apps/backend/test/e2e/app";
import { setupActAs } from "@apps/backend/test/e2e/act-as.helper";
import { createTestProduct, createTestStore } from "@apps/backend/test/integration/factories";

/**
 * 운영자 대신 입력 중(기획 I-41) 판매자 경로: 허용 목록만 열리고, 정산 계좌는 못 바꾸고,
 * 만든 상품은 숨김 + "운영자 입력", 지우기는 운영자가 만든 것만, 모든 요청이 값 없이 기록된다.
 */
describe("가게 대신 입력 중 판매자 경로 (e2e)", () => {
  function productBody(storeId: string) {
    return {
      storeId,
      name: "딸기 생크림 케이크",
      images: ["https://example.com/cake.jpg"],
      originalPrice: 35000,
      salePrice: 35000,
      salesStatus: "ENABLE",
      visibilityStatus: "ENABLE",
      productType: "BASIC_CAKE",
      cakeSizeOptions: [{ visible: "ENABLE", displayName: "미니", lengthCm: 10, price: 0 }],
      productNoticeOrigin: "국내산",
    };
  }

  function storeBody(bank: { bankAccountNumber: string; accountHolderName: string }) {
    return {
      name: "구름 케이크",
      phoneNumber: "0212345678",
      bankName: "KAKAO_BANK",
      ...bank,
      refundCancellationPolicy: { rules: [{ daysBeforePickup: 1, refundDescription: "50% 환불" }] },
      address: "서울특별시 마포구 서교동 1",
      roadAddress: "서울특별시 마포구 와우산로 1",
      detailAddress: "101호",
      zonecode: "04000",
      latitude: 37.55,
      longitude: 126.92,
    };
  }

  it("허용 목록 밖 경로는 403이고 막힌 요청도 기록된다", async () => {
    const app = getTestApp();
    const server = app.getHttpServer();
    const { prisma, store, actAs } = await setupActAs(app);
    const { session, auth } = await actAs();

    const blocked: Array<[string, string, object?]> = [
      ["post", "/v1/seller/mypage/withdraw", { reason: "x" }],
      ["post", "/v1/seller/mypage/change-phone", {}],
      ["get", "/v1/seller/mypage/profile"],
      ["get", `/v1/seller/stores/${store.id}/chats`],
      ["patch", "/v1/seller/orders/ord_1/status", { status: "CONFIRMED" }],
      ["get", `/v1/seller/stores/${store.id}/quote-requests/req_1`],
      ["put", "/v1/seller/notifications/preferences", { storeId: store.id }],
      ["patch", "/v1/seller/notifications/read-all", { storeId: store.id }],
      ["get", `/v1/seller/stores/${store.id}/calendar-feed`],
      ["post", "/v1/seller/fcm-tokens", { token: "t", deviceId: "d" }],
      ["post", "/v1/seller/store/create", {}],
      ["get", `/v1/seller/store/${store.id}/link-stats`],
      ["get", `/v1/seller/store/${store.id}/feed`],
    ];
    for (const [method, url, body] of blocked) {
      const res = await (request(server) as never as Record<string, (u: string) => request.Test>)
        [method](url)
        .set("Authorization", auth)
        .send(body ?? {});
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.data.message, `${method} ${url}`).toBe(
        AUTH_ERROR_MESSAGES.ACT_AS_ROUTE_BLOCKED,
      );
    }

    // 허용한 경로는 열린다
    expect(
      (await request(server).get("/v1/seller/auth/me").set("Authorization", auth)).status,
    ).toBe(200);
    expect(
      (
        await request(server)
          .get("/v1/seller/store/list?page=1&limit=20")
          .set("Authorization", auth)
      ).status,
    ).toBe(200);

    // 가드에서 막힌 요청은 기다리지 않고 남기므로 잠깐 기다린다
    let rows: Array<{ status: number }> = [];
    for (let i = 0; i < 20; i += 1) {
      rows = await prisma.adminActAsAction.findMany({ where: { sessionId: session.id } });
      if (rows.length >= blocked.length + 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(rows.filter((r) => r.status === 403)).toHaveLength(blocked.length);
    expect(rows.filter((r) => r.status === 200)).toHaveLength(2);
  });

  it("들어간 가게가 아닌 스토어는 403", async () => {
    const app = getTestApp();
    const server = app.getHttpServer();
    const { prisma, seller, actAs } = await setupActAs(app);
    const other = await createTestStore(prisma, seller.id, {
      name: "다른 가게",
      businessNo: "111-11-11111",
    });
    const { auth } = await actAs();

    const res = await request(server)
      .get(`/v1/seller/store/${other.id}`)
      .set("Authorization", auth);
    expect(res.status).toBe(403);
    expect(res.body.data.message).toBe(AUTH_ERROR_MESSAGES.ACT_AS_OTHER_STORE);
    const list = await request(server)
      .get(`/v1/seller/stores/${other.id}/manual-orders?startDate=2026-12-01&endDate=2026-12-31`)
      .set("Authorization", auth);
    expect(list.status).toBe(403);
    const create = await request(server)
      .post("/v1/seller/products")
      .set("Authorization", auth)
      .send(productBody(other.id));
    expect(create.status).toBe(403);

    // 상품 id로 부르는 경로도 다른 가게 상품이면 403(가드는 가게를 모르므로 서비스가 막는다)
    const otherProduct = await createTestProduct(prisma, other.id, { name: "다른 가게 케이크" });
    for (const [method, url, body] of [
      ["get", `/v1/seller/products/${otherProduct.id}`],
      ["put", `/v1/seller/products/${otherProduct.id}`, { name: "바꿈" }],
      ["delete", `/v1/seller/products/${otherProduct.id}`],
      ["delete", `/v1/seller/products/${otherProduct.id}/naver-item`],
    ] as Array<[string, string, object?]>) {
      const res = await (request(server) as never as Record<string, (u: string) => request.Test>)
        [method](url)
        .set("Authorization", auth)
        .send(body ?? {});
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.data.message, `${method} ${url}`).toBe(
        AUTH_ERROR_MESSAGES.ACT_AS_OTHER_STORE,
      );
    }
    expect((await prisma.product.findUniqueOrThrow({ where: { id: otherProduct.id } })).name).toBe(
      "다른 가게 케이크",
    );

    // storeId 없이 부르는 목록은 들어간 가게 것만
    const products = await request(server)
      .get("/v1/seller/products?page=1&limit=50&sortBy=latest")
      .set("Authorization", auth);
    expect(products.status).toBe(200);
    expect(JSON.stringify(products.body)).not.toContain(otherProduct.id);
    const stores = await request(server)
      .get("/v1/seller/store/list?page=1&limit=20")
      .set("Authorization", auth);
    expect(stores.status).toBe(200);
    expect(JSON.stringify(stores.body)).not.toContain(other.id);
  });

  it("정산 계좌: 대리 입력은 바꾸면 403·같으면 통과, 사장님은 그대로 바꾼다", async () => {
    const app = getTestApp();
    const server = app.getHttpServer();
    const { prisma, store, sellerAuth, actAs } = await setupActAs(app);
    const { auth } = await actAs();

    const changed = await request(server)
      .put(`/v1/seller/store/${store.id}`)
      .set("Authorization", auth)
      .send(storeBody({ bankAccountNumber: "1111222233334", accountHolderName: "김사장" }));
    expect(changed.status).toBe(403);
    expect(changed.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.BANK_ACCOUNT_LOCKED);
    const holder = await request(server)
      .put(`/v1/seller/store/${store.id}`)
      .set("Authorization", auth)
      .send(storeBody({ bankAccountNumber: "3333000000000", accountHolderName: "다른 사람" }));
    expect(holder.status).toBe(403);
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).bankAccountNumber,
    ).toBe("3333000000000");

    const same = await request(server)
      .put(`/v1/seller/store/${store.id}`)
      .set("Authorization", auth)
      .send(storeBody({ bankAccountNumber: "3333000000000", accountHolderName: "김사장" }));
    expect(same.status).toBe(200);

    const bySeller = await request(server)
      .put(`/v1/seller/store/${store.id}`)
      .set("Authorization", sellerAuth)
      .send(storeBody({ bankAccountNumber: "1111222233334", accountHolderName: "김사장" }));
    expect(bySeller.status).toBe(200);
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).bankAccountNumber,
    ).toBe("1111222233334");
  });

  it("상품: 대리 입력으로 만들면 숨김 + 운영자 입력, 지우기는 운영자가 만든 것만, 손님 응답엔 표시 없음", async () => {
    const app = getTestApp();
    const server = app.getHttpServer();
    const { prisma, store, admin, sellerAuth, actAs } = await setupActAs(app);
    const { session, auth } = await actAs();
    const own = await createTestProduct(prisma, store.id, { name: "사장님 케이크" });

    const created = await request(server)
      .post("/v1/seller/products")
      .set("Authorization", auth)
      .send(productBody(store.id));
    expect(created.status).toBe(201);
    const productId = created.body.data.id as string;
    const row = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(row.visibilityStatus).toBe("DISABLE");
    expect(row.createdByAdminId).toBe(admin.id);

    const list = await request(server)
      .get(`/v1/seller/products?storeId=${store.id}&page=1&limit=20&sortBy=latest`)
      .set("Authorization", sellerAuth);
    expect(list.status).toBe(200);
    const byId = new Map(
      (list.body.data.data as Array<{ id: string; enteredByOperator: boolean }>).map((p) => [
        p.id,
        p,
      ]),
    );
    expect(byId.get(productId)?.enteredByOperator).toBe(true);
    expect(byId.get(own.id)?.enteredByOperator).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain(admin.id);

    const detail = await request(server)
      .get(`/v1/seller/products/${productId}`)
      .set("Authorization", sellerAuth);
    expect(detail.body.data.enteredByOperator).toBe(true);
    expect(detail.body.data).not.toHaveProperty("createdByAdminId");

    // 손님 응답에는 운영자 표시도 관리자 id도 없다(사장님이 공개한 뒤)
    await prisma.product.update({ where: { id: productId }, data: { visibilityStatus: "ENABLE" } });
    const forConsumer = await request(server).get(`/v1/consumer/products/${productId}`);
    expect(forConsumer.status).toBe(200);
    expect(forConsumer.body.data).not.toHaveProperty("enteredByOperator");
    expect(forConsumer.body.data).not.toHaveProperty("createdByAdminId");

    // 손님에게 보이기는 사장님만 바꾼다: 대리 입력으로 바꾸면 403, 그대로 두고 고치면 통과
    const ownRow = await prisma.product.findUniqueOrThrow({ where: { id: own.id } });
    const flip = ownRow.visibilityStatus === "ENABLE" ? "DISABLE" : "ENABLE";
    const hideOwn = await request(server)
      .put(`/v1/seller/products/${own.id}`)
      .set("Authorization", auth)
      .send({ visibilityStatus: flip });
    expect(hideOwn.status).toBe(403);
    expect(hideOwn.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.VISIBILITY_OWNER_ONLY);
    // (위에서 사장님이 공개해 지금은 ENABLE) 운영자가 숨기려 해도 403, 그대로 보내며 이름만 고치면 통과
    const hideMine = await request(server)
      .put(`/v1/seller/products/${productId}`)
      .set("Authorization", auth)
      .send({ visibilityStatus: "DISABLE" });
    expect(hideMine.status).toBe(403);
    const renameMine = await request(server)
      .put(`/v1/seller/products/${productId}`)
      .set("Authorization", auth)
      .send({ name: "딸기 케이크", visibilityStatus: "ENABLE" });
    expect(renameMine.status).toBe(200);
    const renamed = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(renamed).toMatchObject({ name: "딸기 케이크", visibilityStatus: "ENABLE" });

    const delOwn = await request(server)
      .delete(`/v1/seller/products/${own.id}`)
      .set("Authorization", auth);
    expect(delOwn.status).toBe(403);
    expect(delOwn.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.DELETE_OPERATOR_ONLY);
    const delMine = await request(server)
      .delete(`/v1/seller/products/${productId}`)
      .set("Authorization", auth);
    expect(delMine.status).toBe(200);

    // 기록: 만든 상품 id가 대상으로, 보낸 칸 이름만(값 없음)
    const actions = await prisma.adminActAsAction.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    const create = actions.find((a) => a.method === "POST" && a.route === "/seller/products");
    expect(create).toMatchObject({ status: 201, targetId: productId });
    expect(create?.fields).toContain("productNoticeOrigin");
    expect(JSON.stringify(actions)).not.toContain("딸기 생크림 케이크");
    expect(actions.find((a) => a.method === "DELETE" && a.targetId === own.id)?.status).toBe(403);
  });

  it("직접 적은 주문: 운영자 입력 표시, 지우기는 운영자가 적은 것만, 사장님 요청은 기록하지 않는다", async () => {
    const app = getTestApp();
    const server = app.getHttpServer();
    const { prisma, store, sellerAuth, actAs } = await setupActAs(app);
    const { session, auth } = await actAs();
    const base = `/v1/seller/stores/${store.id}/manual-orders`;
    const order = {
      pickupDate: "2026-12-24",
      pickupTime: "14:00",
      cakeName: "레터링 케이크 1호",
      customerName: "홍길순",
      source: "KAKAO",
    };

    const bySeller = await request(server).post(base).set("Authorization", sellerAuth).send(order);
    expect(bySeller.status).toBe(201);
    expect(bySeller.body.data.enteredByOperator).toBe(false);
    const byOperator = await request(server).post(base).set("Authorization", auth).send(order);
    expect(byOperator.status).toBe(201);
    expect(byOperator.body.data.enteredByOperator).toBe(true);
    expect(JSON.stringify(byOperator.body)).not.toContain("createdByAdminId");

    const delSeller = await request(server)
      .delete(`${base}/${bySeller.body.data.id}`)
      .set("Authorization", auth);
    expect(delSeller.status).toBe(403);
    const delOperator = await request(server)
      .delete(`${base}/${byOperator.body.data.id}`)
      .set("Authorization", auth);
    expect(delOperator.status).toBe(200);
    // 사장님이 적은 주문은 운영자가 고치거나 입금 표시를 바꾸지 못한다(사진·내용을 되살릴 수 없어서)
    const sellerOrderId = bySeller.body.data.id as string;
    const editSeller = await request(server)
      .put(`${base}/${sellerOrderId}`)
      .set("Authorization", auth)
      .send({ ...order, customerName: null, photoUrls: [] });
    expect(editSeller.status).toBe(403);
    expect(editSeller.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.EDIT_OPERATOR_ONLY);
    const paidSeller = await request(server)
      .patch(`${base}/${sellerOrderId}/paid`)
      .set("Authorization", auth)
      .send({ paid: true });
    expect(paidSeller.status).toBe(403);
    expect(
      await prisma.manualOrder.findUniqueOrThrow({ where: { id: sellerOrderId } }),
    ).toMatchObject({ customerName: "홍길순", paid: null });

    // 사장님은 운영자가 적은 것도 지울 수 있다(사장님 장부). 운영자는 자기가 적은 것은 고친다
    const again = await request(server).post(base).set("Authorization", auth).send(order);
    const editMine = await request(server)
      .put(`${base}/${again.body.data.id}`)
      .set("Authorization", auth)
      .send({ ...order, cakeName: "레터링 케이크 2호" });
    expect(editMine.status).toBe(200);
    const sellerDeletes = await request(server)
      .delete(`${base}/${again.body.data.id}`)
      .set("Authorization", sellerAuth);
    expect(sellerDeletes.status).toBe(200);

    const actions = await prisma.adminActAsAction.findMany({ where: { sessionId: session.id } });
    expect(JSON.stringify(actions)).not.toContain("홍길순");
    // 사장님 출입증 요청(만들기 1·지우기 1)은 기록에 없다: 대리 요청 7개만
    expect(await prisma.adminActAsAction.count()).toBe(7);
    expect(actions.every((a) => a.route.startsWith("/seller/stores/:storeId/manual-orders"))).toBe(
      true,
    );
  });
});
