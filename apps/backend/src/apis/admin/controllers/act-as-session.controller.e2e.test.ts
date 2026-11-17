import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";
import { ADMIN_API_KEY_HEADER } from "@apps/backend/modules/admin-api-key/constants/admin-api-key.constants";
import { AdminApiKeyService } from "@apps/backend/modules/admin-api-key/services/admin-api-key.service";
import { getTestApp } from "@apps/backend/test/e2e/app";
import { setupActAs } from "@apps/backend/test/e2e/act-as.helper";
import { createTestStore } from "@apps/backend/test/integration/factories";

/**
 * 운영자가 가게 대신 입력하기(기획 I-41) — 들어가기·코드 바꾸기·끝내기·기록을 실제 HTTP로.
 * 들어가기는 사람 관리자 + 환경값에 적은 관리자 + OTP, 출입증은 매 요청 세션 행을 본다.
 */
describe("가게 대신 입력 세션 (e2e)", () => {
  const start = (auth: string, storeId: string, body: object) =>
    request(getTestApp().getHttpServer())
      .post(`/v1/admin/stores/${storeId}/act-as-sessions`)
      .set("Authorization", auth)
      .send(body);

  it("들어가기 → 코드 바꾸기(한 번만) → 띠 → 끝내기 뒤 바로 401 → 기록", async () => {
    const app = getTestApp();
    const server = app.getHttpServer();
    const { prisma, adminAuth, sellerAuth, otp, store } = await setupActAs(app);

    const res = await start(adminAuth, store.id, {
      reason: "카톡 요청 — 첫 상품",
      totpCode: otp(),
    });
    expect(res.status).toBe(201);
    const { sessionId, sellerUrl } = res.body.data;
    expect(sellerUrl).toMatch(/\/act-as\?code=/);
    const code = new URL(sellerUrl).searchParams.get("code")!;
    // 코드 원문은 저장하지 않는다(해시만)
    const row = await prisma.adminActAsSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.codeHash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(row.expiresAt.getTime() - row.startedAt.getTime()).toBe(60 * 60 * 1000);

    const ex = await request(server).post("/v1/seller/act-as/exchange").send({ code });
    expect(ex.status).toBe(200);
    expect(ex.body.data.storeId).toBe(store.id);
    const auth = `Bearer ${ex.body.data.accessToken}`;

    // 같은 코드는 두 번 못 쓴다
    const again = await request(server).post("/v1/seller/act-as/exchange").send({ code });
    expect(again.status).toBe(400);
    expect(again.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.CODE_INVALID);

    const me = await request(server).get("/v1/seller/act-as/me").set("Authorization", auth);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ sessionId, storeId: store.id, storeName: "구름 케이크" });

    // 사장님 출입증으로는 띠·끝내기를 못 부른다
    const sellerMe = await request(server)
      .get("/v1/seller/act-as/me")
      .set("Authorization", sellerAuth);
    expect(sellerMe.status).toBe(403);

    const end = await request(server).post("/v1/seller/act-as/end").set("Authorization", auth);
    expect(end.status).toBe(200);
    const after = await request(server).get("/v1/seller/auth/me").set("Authorization", auth);
    expect(after.status).toBe(401);
    expect(after.body.data.message).toBe(AUTH_ERROR_MESSAGES.ACT_AS_SESSION_ENDED);

    const list = await request(server)
      .get(`/v1/admin/stores/${store.id}/act-as-sessions`)
      .set("Authorization", adminAuth);
    expect(list.status).toBe(200);
    expect(list.body.data.data).toHaveLength(1);
    expect(list.body.data.data[0]).toMatchObject({
      id: sessionId,
      reason: "카톡 요청 — 첫 상품",
      status: "ENDED",
      endedBy: "self",
    });

    const actions = await request(server)
      .get(`/v1/admin/act-as-sessions/${sessionId}/actions`)
      .set("Authorization", adminAuth);
    expect(actions.status).toBe(200);
    expect(actions.body.data.data.map((a: { route: string }) => a.route)).toEqual([
      "/seller/act-as/exchange",
      "/seller/act-as/me",
      "/seller/act-as/end",
    ]);
  });

  it("코드는 60초가 지나면 못 쓴다", async () => {
    const app = getTestApp();
    const { prisma, adminAuth, otp, store } = await setupActAs(app);
    const res = await start(adminAuth, store.id, { reason: "시간 지난 코드", totpCode: otp() });
    const code = new URL(res.body.data.sellerUrl).searchParams.get("code")!;
    await prisma.adminActAsSession.update({
      where: { id: res.body.data.sessionId },
      data: { codeExpiresAt: new Date(Date.now() - 1000) },
    });
    const ex = await request(app.getHttpServer()).post("/v1/seller/act-as/exchange").send({ code });
    expect(ex.status).toBe(400);
    const unknown = await request(app.getHttpServer())
      .post("/v1/seller/act-as/exchange")
      .send({ code: randomBytes(32).toString("base64url") });
    expect(unknown.status).toBe(400);
  });

  it("들어가기 거절: API 키·허용 목록 밖 관리자·틀린 OTP·사유 없음·심사용 가게·꺼진 판매자", async () => {
    const app = getTestApp();
    const { prisma, adminAuth, otp, store, seller, admin } = await setupActAs(app);

    // 자동화용 관리자 API 키
    const { apiKey: rawKey } = await app.get(AdminApiKeyService).create("테스트 루틴", admin.id);
    const byKey = await request(app.getHttpServer())
      .post(`/v1/admin/stores/${store.id}/act-as-sessions`)
      .set(ADMIN_API_KEY_HEADER, rawKey)
      .send({ reason: "루틴", totpCode: "123456" });
    expect(byKey.status).toBe(403);
    expect(byKey.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.HUMAN_ONLY);

    const wrongOtp = await start(adminAuth, store.id, { reason: "틀린 OTP", totpCode: "000000" });
    expect(wrongOtp.status).toBe(400);
    expect(wrongOtp.body.data.message).toBe(AUTH_ERROR_MESSAGES.OTP_CODE_INVALID);

    const noReason = await start(adminAuth, store.id, { reason: " ", totpCode: otp() });
    expect(noReason.status).toBe(400);

    const review = await createTestStore(prisma, seller.id, {
      businessNo: REVIEW_STORE_BUSINESS_NO,
      name: "심사용",
    });
    const toReview = await start(adminAuth, review.id, { reason: "심사용", totpCode: otp() });
    expect(toReview.status).toBe(403);
    expect(toReview.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.REVIEW_STORE);

    await prisma.seller.update({ where: { id: seller.id }, data: { isActive: false } });
    const inactive = await start(adminAuth, store.id, { reason: "꺼진 판매자", totpCode: otp() });
    expect(inactive.status).toBe(403);
    expect(inactive.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.SELLER_INACTIVE);

    expect(await prisma.adminActAsSession.count()).toBe(0);
  });

  it("환경값에 없는 관리자는 들어갈 수 없다", async () => {
    const app = getTestApp();
    const { adminAuth, otp, store } = await setupActAs(app, { allowAdmin: false });
    const res = await start(adminAuth, store.id, { reason: "허용 안 됨", totpCode: otp() });
    expect(res.status).toBe(403);
    expect(res.body.data.message).toBe(ACT_AS_ERROR_MESSAGES.ADMIN_NOT_ALLOWED);
  });

  it("출입증은 60분이 지나거나·관리자가 끝내거나·관리자·판매자를 끄면 바로 401", async () => {
    const app = getTestApp();
    const server = app.getHttpServer();
    const { prisma, adminAuth, admin, seller, actAs } = await setupActAs(app);
    const me = (auth: string) =>
      request(server).get("/v1/seller/auth/me").set("Authorization", auth);

    const expired = await actAs({ expiresAt: new Date(Date.now() - 1000) });
    expect((await me(expired.auth)).status).toBe(401);

    const byAdmin = await actAs();
    expect((await me(byAdmin.auth)).status).toBe(200);
    const end = await request(server)
      .post(`/v1/admin/act-as-sessions/${byAdmin.session.id}/end`)
      .set("Authorization", adminAuth);
    expect(end.status).toBe(200);
    expect((await me(byAdmin.auth)).status).toBe(401);
    const row = await prisma.adminActAsSession.findUniqueOrThrow({
      where: { id: byAdmin.session.id },
    });
    expect(row.endedBy).toBe(`admin:${admin.id}`);

    const adminOff = await actAs();
    await prisma.admin.update({ where: { id: admin.id }, data: { isActive: false } });
    expect((await me(adminOff.auth)).status).toBe(401);
    await prisma.admin.update({ where: { id: admin.id }, data: { isActive: true } });

    const sellerOff = await actAs();
    await prisma.seller.update({ where: { id: seller.id }, data: { isActive: false } });
    expect((await me(sellerOff.auth)).status).toBe(401);
  });
});
