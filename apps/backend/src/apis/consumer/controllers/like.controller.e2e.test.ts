import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { getTestApp } from "@apps/backend/test/e2e/app";
import { createTestConsumer } from "@apps/backend/test/integration/factories";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * 케이크 디자인 모음 좋아요(기획 I-112) 세 경로를 실제 HTTP로:
 * 가드(로그인 필요·선택) → 컨트롤러 → 서비스 → DB → 공통 응답 모양.
 */
describe("디자인 좋아요 /v1/consumer/designs (e2e)", () => {
  async function setup() {
    const app = getTestApp();
    const prisma = app.get(PrismaService);
    const jwtUtil = app.get(JwtUtil);
    const consumer = await createTestConsumer(prisma);
    const accessToken = await jwtUtil.generateAccessToken({
      sub: consumer.id,
      aud: AUDIENCE.CONSUMER,
    });
    return { app, prisma, consumer, auth: `Bearer ${accessToken}` };
  }

  it("좋아요(두 번 눌러도 성공) → 수·내 좋아요 → 취소(두 번 해도 성공)", async () => {
    const { app, prisma, consumer, auth } = await setup();
    const server = app.getHttpServer();

    for (let i = 0; i < 2; i += 1) {
      const res = await request(server)
        .post("/v1/consumer/designs/bento-heart-lettering/like")
        .set("Authorization", auth);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ message: "디자인에 좋아요를 추가했어요." });
    }
    expect(await prisma.designLike.count({ where: { consumerId: consumer.id } })).toBe(1);

    const mine = await request(server).get("/v1/consumer/designs/likes").set("Authorization", auth);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toEqual({
      counts: { "bento-heart-lettering": 1 },
      myLikes: ["bento-heart-lettering"],
    });

    // 로그인하지 않아도 수는 보인다
    const anonymous = await request(server).get("/v1/consumer/designs/likes");
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data).toEqual({
      counts: { "bento-heart-lettering": 1 },
      myLikes: [],
    });

    for (let i = 0; i < 2; i += 1) {
      const res = await request(server)
        .delete("/v1/consumer/designs/bento-heart-lettering/like")
        .set("Authorization", auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ message: "디자인 좋아요를 취소했어요." });
    }
    const after = await request(server)
      .get("/v1/consumer/designs/likes")
      .set("Authorization", auth);
    expect(after.body.data).toEqual({ counts: {}, myLikes: [] });
  });

  it("로그인하지 않으면 좋아요·취소는 401, 디자인 ID 모양이 틀리면 400", async () => {
    const { app, prisma, auth } = await setup();
    const server = app.getHttpServer();

    expect((await request(server).post("/v1/consumer/designs/mini-ribbon/like")).status).toBe(401);
    expect((await request(server).delete("/v1/consumer/designs/mini-ribbon/like")).status).toBe(
      401,
    );

    const bad = await request(server)
      .post("/v1/consumer/designs/Bento_Heart/like")
      .set("Authorization", auth);
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);
    expect(bad.body.data.message).toBe("디자인을 찾을 수 없어요.");
    expect(await prisma.designLike.count()).toBe(0);
  });

  it("300개를 넘는 좋아요는 400(한국어 안내), 이미 누른 디자인은 그대로 성공", async () => {
    const { app, prisma, consumer, auth } = await setup();
    const server = app.getHttpServer();
    await prisma.designLike.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        consumerId: consumer.id,
        designId: `full-${i}`,
      })),
    });

    const over = await request(server)
      .post("/v1/consumer/designs/one-more/like")
      .set("Authorization", auth);
    expect(over.status).toBe(400);
    expect(over.body.success).toBe(false);
    expect(over.body.data.message).toBe("좋아요는 300개까지 할 수 있어요.");

    const again = await request(server)
      .post("/v1/consumer/designs/full-7/like")
      .set("Authorization", auth);
    expect(again.status).toBe(201);
    expect(await prisma.designLike.count({ where: { consumerId: consumer.id } })).toBe(300);
  });
});
