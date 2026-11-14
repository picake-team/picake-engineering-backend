import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

// Claude는 부르지 않는다: SDK 클라이언트를 가짜로 바꾼다
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create };
  },
}));

import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { QuotePhotoReadService } from "@apps/backend/modules/quote-request/services/quote-photo-read.service";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const IMAGE = `data:image/jpeg;base64,${JPEG.toString("base64")}`;
const OUTPUT = {
  isCake: true,
  rows: {
    shape: "하트 모양 케이크",
    creamColor: "연분홍",
    border: null,
    decoration: "딸기 3개",
    lettering: '"지민아 생일 축하해" 흰 글씨',
    candlesToppers: null,
    creamType: null,
  },
  parts: {
    shape: "하트 모양 케이크",
    color: "연분홍",
    decoration: "딸기 3개",
    lettering: '"지민아 생일 축하해" 흰 글씨',
  },
  description:
    '사진처럼 연분홍 하트 케이크에 딸기 3개를 올리고 "지민아 생일 축하해"를 흰 글씨로 써 주세요.',
  size: null,
  creams: [],
  requestNote: "",
};
const reply = (output: unknown, stop = "end_turn") => ({
  model: "claude-haiku-5-5",
  stop_reason: stop,
  content: [{ type: "text", text: JSON.stringify(output) }],
  usage: { input_tokens: 900, output_tokens: 300 },
});

function build(apiKey = "test-key") {
  const config = { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? apiKey : undefined) };
  return new QuotePhotoReadService(config as unknown as ConfigService);
}

describe("QuotePhotoReadService(견적 요청서 사진 읽기)", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(reply(OUTPUT));
  });

  it("읽은 값을 돌려준다", async () => {
    const r = await build().read(IMAGE, { consumerId: "c1" });
    expect(r).toMatchObject({
      description: OUTPUT.description,
      parts: OUTPUT.parts,
      size: null,
      creams: [],
      requestNote: "",
    });
    expect("read" in r && r.read.map((x) => x.label)).toEqual([
      "모양",
      "크림 색",
      "테두리",
      "장식",
      "글자",
      "초·토퍼",
      "크림 종류",
    ]);
  });

  it("케이크가 아니면 { unreadable: true }만", async () => {
    create.mockResolvedValue(reply({ ...OUTPUT, isCake: false }));
    expect(await build().read(IMAGE, { ip: "1.1.1.1" })).toEqual({ unreadable: true });
    create.mockResolvedValue(reply(OUTPUT, "refusal"));
    expect(await build().read(IMAGE, { ip: "1.1.1.1" })).toEqual({ unreadable: true });
  });

  it("키가 없으면 503, 사진이 아니면 400(Claude를 부르지 않고 횟수도 세지 않음)", async () => {
    await expect(build("").read(IMAGE, { ip: "1.1.1.1" })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const service = build();
    for (let i = 0; i < 25; i += 1) {
      await expect(
        service.read("data:image/gif;base64,R0lGODlhAQABAAAAACw=", { ip: "1.1.1.1" }),
      ).rejects.toThrow(
        new BadRequestException(
          "JPG나 PNG 사진만 읽을 수 있어요. 다른 사진으로 다시 시도해 주세요.",
        ),
      );
    }
    expect(create).not.toHaveBeenCalled();
    await expect(service.read(IMAGE, { ip: "1.1.1.1" })).resolves.toHaveProperty("description");
  });

  it("하루 20번: 로그인하면 손님마다, 아니면 접속 주소마다 따로 센다", async () => {
    const service = build();
    for (let i = 0; i < 20; i += 1) await service.read(IMAGE, { consumerId: "c1", ip: "1.1.1.1" });
    const over = service.read(IMAGE, { consumerId: "c1", ip: "2.2.2.2" });
    await expect(over).rejects.toBeInstanceOf(HttpException);
    await expect(service.read(IMAGE, { consumerId: "c1" })).rejects.toMatchObject({
      status: 429,
      message: "오늘은 사진 읽기를 다 썼어요. 직접 적어 주세요.",
    });
    // 같은 주소라도 로그인하지 않은 요청은 주소로 센다(손님 한도와 따로)
    await expect(service.read(IMAGE, { ip: "1.1.1.1" })).resolves.toHaveProperty("description");
    await expect(service.read(IMAGE, { consumerId: "c2" })).resolves.toHaveProperty("description");

    for (let i = 0; i < 19; i += 1) await service.read(IMAGE, { ip: "1.1.1.1" });
    await expect(service.read(IMAGE, { ip: "1.1.1.1" })).rejects.toMatchObject({ status: 429 });
    await expect(service.read(IMAGE, { ip: "3.3.3.3" })).resolves.toHaveProperty("description");
    expect(create).toHaveBeenCalledTimes(20 + 2 + 19 + 1);
  });

  it("Claude가 실패하면 502이고 그 횟수는 되돌린다", async () => {
    const service = build();
    for (let i = 0; i < 19; i += 1) await service.read(IMAGE, { ip: "9.9.9.9" });
    create.mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 529 }));
    await expect(service.read(IMAGE, { ip: "9.9.9.9" })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    // 실패한 번은 세지 않아 한 번 더 쓸 수 있다
    await expect(service.read(IMAGE, { ip: "9.9.9.9" })).resolves.toHaveProperty("description");
    await expect(service.read(IMAGE, { ip: "9.9.9.9" })).rejects.toMatchObject({ status: 429 });
  });

  it("로그에는 사용량만 남기고 사진·읽은 글·접속 주소는 남기지 않는다", async () => {
    const log = vi.spyOn(LoggerUtil, "log").mockImplementation(() => undefined);
    await build().read(IMAGE, { ip: "203.0.113.7" });
    const text = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text).toContain("사진 읽기:");
    expect(text).toContain("in=900 out=300");
    expect(text).not.toContain("지민");
    expect(text).not.toContain("203.0.113.7");
    expect(text).not.toContain(JPEG.toString("base64"));
    log.mockRestore();
  });
});
