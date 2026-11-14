import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { QuotePhotoReadService } from "@apps/backend/modules/quote-request/services/quote-photo-read.service";
import { getTestApp } from "@apps/backend/test/e2e/app";
import { createTestConsumer } from "@apps/backend/test/integration/factories";

/**
 * 견적 요청서 사진 읽기(기획 I-112 1-나)를 실제 HTTP로: 로그인 없이도 열림, 이 경로만 큰 JSON(사진) 받기,
 * 전역 ValidationPipe, 공통 응답 모양. Claude는 부르지 않는다(서비스의 클라이언트를 가짜로 바꿈).
 */
describe("POST /v1/consumer/quote-requests/photo-read (e2e)", () => {
  const OUTPUT = {
    isCake: true,
    rows: {
      shape: "원형 1단 도시락 케이크",
      creamColor: "흰색",
      border: "분홍 하트 테두리",
      decoration: null,
      lettering: '"생일 축하해" 갈색 손글씨',
      candlesToppers: null,
      creamType: null,
    },
    parts: {
      shape: "흰 크림 도시락 케이크",
      color: "흰색",
      decoration: "분홍 하트 테두리",
      lettering: '"생일 축하해" 갈색 손글씨',
    },
    description:
      '사진처럼 흰 크림 도시락 케이크에 분홍 하트 테두리를 두르고 "생일 축하해"를 갈색으로 써 주세요.',
    size: "LUNCHBOX",
    creams: [],
    requestNote: "",
  };

  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  function stubClaude() {
    const service = getTestApp().get(QuotePhotoReadService) as unknown as { client: unknown };
    const original = service.client;
    const create = vi.fn(async () => ({
      model: "claude-haiku-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(OUTPUT) }],
      usage: { input_tokens: 900, output_tokens: 300 },
    }));
    service.client = { messages: { create } };
    restore = () => {
      service.client = original;
    };
    return create;
  }

  /** 기본 JSON 한도(100kb)보다 큰 JPG(웹이 줄인 사진 크기) */
  function jpegDataUrl(bytes: number) {
    const buf = Buffer.alloc(bytes, 7);
    buf.set([0xff, 0xd8, 0xff, 0xe0]);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }

  it("로그인하지 않아도 400KB 사진을 받아 읽은 값을 돌려준다", async () => {
    const create = stubClaude();
    const res = await request(getTestApp().getHttpServer())
      .post("/v1/consumer/quote-requests/photo-read")
      .send({ image: jpegDataUrl(400 * 1024) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      read: [
        { label: "모양", value: "원형 1단 도시락 케이크" },
        { label: "크림 색", value: "흰색" },
        { label: "테두리", value: "분홍 하트 테두리" },
        { label: "장식", value: null },
        { label: "글자", value: '"생일 축하해" 갈색 손글씨' },
        { label: "초·토퍼", value: null },
        { label: "크림 종류", value: null },
      ],
      parts: OUTPUT.parts,
      description: OUTPUT.description,
      size: "LUNCHBOX",
      creams: [],
      requestNote: "",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("로그인한 손님도 쓰고, 케이크가 아니면 { unreadable: true }만", async () => {
    const app = getTestApp();
    const create = stubClaude();
    create.mockResolvedValueOnce({
      model: "claude-haiku-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ ...OUTPUT, isCake: false }) }],
      usage: { input_tokens: 900, output_tokens: 20 },
    });
    const consumer = await createTestConsumer(app.get(PrismaService));
    const token = await app
      .get(JwtUtil)
      .generateAccessToken({ sub: consumer.id, aud: AUDIENCE.CONSUMER });

    const res = await request(app.getHttpServer())
      .post("/v1/consumer/quote-requests/photo-read")
      .set("Authorization", `Bearer ${token}`)
      .send({ image: jpegDataUrl(1000) });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ unreadable: true });
  });

  it("사진이 아니면 400, 모르는 칸은 400, 4MB를 넘는 본문은 413(모두 한국어 안내), Claude는 부르지 않는다", async () => {
    const create = stubClaude();
    const server = getTestApp().getHttpServer();

    const gif = await request(server)
      .post("/v1/consumer/quote-requests/photo-read")
      .send({ image: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
    expect(gif.status).toBe(400);
    expect(gif.body.data.message).toBe(
      "JPG나 PNG 사진만 읽을 수 있어요. 다른 사진으로 다시 시도해 주세요.",
    );

    const extra = await request(server)
      .post("/v1/consumer/quote-requests/photo-read")
      .send({ image: jpegDataUrl(100), keep: true });
    expect(extra.status).toBe(400);

    const huge = await request(server)
      .post("/v1/consumer/quote-requests/photo-read")
      .send({ image: jpegDataUrl(3_200_000) });
    expect(huge.status).toBe(413);
    expect(huge.body.data.message).toBe("사진이 너무 커요. 더 작은 사진으로 다시 시도해 주세요.");

    // 풀면 2.5MB를 넘지만 본문 한도(4MB) 안: 서비스가 막는다
    const big = await request(server)
      .post("/v1/consumer/quote-requests/photo-read")
      .send({ image: jpegDataUrl(2_700_000) });
    expect(big.status).toBe(400);
    expect(big.body.data.message).toBe("사진이 너무 커요. 더 작은 사진으로 다시 시도해 주세요.");
    expect(create).not.toHaveBeenCalled();
  });

  it("다른 경로의 JSON 한도는 그대로(100kb)", async () => {
    const server = getTestApp().getHttpServer();
    const send = (body: object) =>
      request(server)
        .post("/v1/consumer/designs/x/like")
        .set("Content-Type", "application/json")
        .send(JSON.stringify(body));
    // 작은 본문은 파서를 지나 인증에서 막히고(401), 큰 본문은 기본 파서가 인증보다 먼저 막는다.
    // 기본 파서의 한도 오류는 Nest 예외가 아니어서 공통 오류 응답이 500으로 내보낸다(이 작업 전부터의 동작)
    expect((await send({ pad: "a" })).status).toBe(401);
    const big = await send({ pad: "a".repeat(200 * 1024) });
    expect(big.status).toBe(500);
    expect(big.body.success).toBe(false);
  });

  it("큰 JSON은 POST 그 경로 하나만: 앞부분만 같은 경로·다른 메서드는 기본 한도(100kb)", async () => {
    const server = getTestApp().getHttpServer();
    const body = JSON.stringify({ image: jpegDataUrl(200 * 1024) });
    // 요청은 하나씩 만든다(supertest는 만들 때 서버를 띄운다)
    const cases = [
      () => request(server).post("/v1/consumer/quote-requests/photo-read/extra"),
      () => request(server).put("/v1/consumer/quote-requests/photo-read"),
      () => request(server).patch("/v1/consumer/quote-requests/photo-read"),
    ];
    for (const make of cases) {
      const res = await make().set("Content-Type", "application/json").send(body);
      // 큰 사진 경로였다면 읽은 뒤 없는 경로(404)가 됐을 것. 기본 파서가 먼저 막는다(위와 같은 500)
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    }
  });

  // 분당 한도(10번)를 다 쓰므로 이 파일의 마지막에 둔다
  it("분당 한도의 429는 '잠시 후 다시 시도해 주세요.'(하루 한도의 '오늘은 다 썼어요'와 다른 글)", async () => {
    const create = stubClaude();
    const server = getTestApp().getHttpServer();
    let limited: request.Response | undefined;
    // 앞의 테스트가 이미 몇 번 썼으므로 429가 날 때까지(한도 10번 + 1) 보낸다. 빈 본문은 400이어도 횟수에 든다
    for (let i = 0; i < 11 && !limited; i += 1) {
      const res = await request(server).post("/v1/consumer/quote-requests/photo-read").send({});
      if (res.status === 429) limited = res;
      else expect(res.status).toBe(400);
    }
    expect(limited?.body.success).toBe(false);
    expect(limited?.body.data.message).toBe("잠시 후 다시 시도해 주세요.");
    expect(limited?.headers["retry-after"]).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });
});
