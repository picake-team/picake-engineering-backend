import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  PHOTO_READ_OUTPUT_SCHEMA,
  parseImageDataUrl,
  readCakePhoto,
  toPhotoReadResult,
} from "@apps/backend/modules/quote-request/utils/quote-photo-read.util";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const GIF = Buffer.from("GIF89a000000", "ascii");
const dataUrl = (type: string, buf: Buffer) =>
  `data:image/${type};base64,${buf.toString("base64")}`;

const goodOutput = {
  isCake: true,
  rows: {
    shape: "원형 1단 도시락 케이크",
    creamColor: "흰색",
    border: "분홍 하트 테두리",
    decoration: null,
    lettering: '"생일 축하해" 갈색 손글씨',
    candlesToppers: "초 1개",
    creamType: null,
  },
  parts: {
    shape: "흰 크림 도시락 케이크",
    color: "흰색",
    decoration: "분홍 하트 테두리",
    lettering: '"생일 축하해" 갈색 손글씨',
  },
  description:
    '사진처럼 흰 크림 도시락 케이크에 분홍 하트 테두리를 두르고 가운데에 "생일 축하해"를 갈색으로 써 주세요.',
  size: "LUNCHBOX",
  creams: [],
  requestNote: "사진처럼 초 1개",
};

describe("parseImageDataUrl(웹이 보낸 사진 확인)", () => {
  it("JPG·PNG는 받고, 형식은 첫 바이트로 정한다", () => {
    expect(parseImageDataUrl(dataUrl("jpeg", JPEG))).toMatchObject({
      ok: true,
      mediaType: "image/jpeg",
    });
    expect(parseImageDataUrl(dataUrl("jpg", JPEG))).toMatchObject({
      ok: true,
      mediaType: "image/jpeg",
    });
    expect(parseImageDataUrl(dataUrl("png", PNG))).toMatchObject({
      ok: true,
      mediaType: "image/png",
    });
    // 앞에는 png라고 했지만 실제로는 JPG
    expect(parseImageDataUrl(dataUrl("png", JPEG))).toMatchObject({
      ok: true,
      mediaType: "image/jpeg",
    });
    const ok = parseImageDataUrl(dataUrl("jpeg", JPEG));
    expect(ok.ok && ok.data).toBe(JPEG.toString("base64"));
  });

  it("사진이 아니거나 data URL이 아니거나 base64가 깨졌으면 INVALID_IMAGE", () => {
    for (const image of [
      dataUrl("gif", GIF),
      dataUrl("png", GIF),
      `data:text/plain;base64,${JPEG.toString("base64")}`,
      "https://cdn.example.com/a.jpg",
      JPEG.toString("base64"),
      "data:image/jpeg;base64,",
      "data:image/jpeg;base64,/9j/4AAQ!!!!",
      "data:image/jpeg;base64,/9j/4AA",
    ]) {
      expect(parseImageDataUrl(image)).toEqual({ ok: false, error: "INVALID_IMAGE" });
    }
  });

  it("풀었을 때 2.5MB를 넘으면 TOO_LARGE(풀어 보기 전에)", () => {
    const max = Math.floor(2.5 * 1024 * 1024);
    const big = Buffer.alloc(max + 3, 0);
    JPEG.copy(big);
    expect(parseImageDataUrl(dataUrl("jpeg", big))).toEqual({ ok: false, error: "TOO_LARGE" });
    const fits = Buffer.alloc(max - (max % 3), 0);
    JPEG.copy(fits);
    expect(parseImageDataUrl(dataUrl("jpeg", fits))).toMatchObject({ ok: true });
  });
});

describe("toPhotoReadResult(읽은 값을 화면에 보낼 모양으로)", () => {
  it("읽은 줄은 서버가 정한 이름·순서로, 나머지는 그대로", () => {
    expect(toPhotoReadResult(goodOutput)).toEqual({
      read: [
        { label: "모양", value: "원형 1단 도시락 케이크" },
        { label: "크림 색", value: "흰색" },
        { label: "테두리", value: "분홍 하트 테두리" },
        { label: "장식", value: null },
        { label: "글자", value: '"생일 축하해" 갈색 손글씨' },
        { label: "초·토퍼", value: "초 1개" },
        { label: "크림 종류", value: null },
      ],
      parts: goodOutput.parts,
      description: goodOutput.description,
      size: "LUNCHBOX",
      creams: [],
      requestNote: "사진처럼 초 1개",
    });
  });

  it("케이크가 아니거나 설명이 비었으면 못 읽음(null)", () => {
    expect(toPhotoReadResult({ ...goodOutput, isCake: false })).toBeNull();
    expect(toPhotoReadResult({ ...goodOutput, description: "   " })).toBeNull();
    expect(toPhotoReadResult(null)).toBeNull();
    expect(toPhotoReadResult("사진처럼")).toBeNull();
  });

  it("설명은 '사진처럼'으로 시작하고 180자까지, 줄바꿈·빈칸은 한 칸으로", () => {
    const r = toPhotoReadResult({
      ...goodOutput,
      description: `흰 케이크\n\n${"가".repeat(300)}`,
    })!;
    expect(r.description.startsWith("사진처럼 흰 케이크 가")).toBe(true);
    expect(Array.from(r.description)).toHaveLength(180);
  });

  it("크기는 도시락·미니만, 크림은 아는 값만 겹치지 않게, 빈 값은 null·빈 문자열", () => {
    const r = toPhotoReadResult({
      ...goodOutput,
      size: "NO1",
      creams: ["BUTTER_CREAM", "BUTTER_CREAM", "WHIPPED"],
      requestNote: "  ",
      rows: { ...goodOutput.rows, shape: "", border: 3 },
      parts: { shape: "", color: null, decoration: "", lettering: null },
    })!;
    expect(r.size).toBeNull();
    expect(r.creams).toEqual(["BUTTER_CREAM"]);
    expect(r.requestNote).toBe("");
    expect(r.read[0]).toEqual({ label: "모양", value: null });
    expect(r.read[2]).toEqual({ label: "테두리", value: null });
    // 따를 것 이름이 비면 읽은 줄의 모양·색으로
    expect(r.parts).toEqual({ shape: "", color: "흰색", decoration: null, lettering: null });
    expect(toPhotoReadResult({ ...goodOutput, size: "MINI" })!.size).toBe("MINI");
  });
});

describe("readCakePhoto(Claude 부르기, 클라이언트는 가짜)", () => {
  function fakeClient(response: Partial<Anthropic.Message>) {
    const create = vi.fn(async () => response);
    return { client: { messages: { create } } as unknown as Anthropic, create };
  }
  const reply = (output: unknown, stop = "end_turn") =>
    ({
      model: "claude-haiku-5-5",
      stop_reason: stop,
      content: [
        { type: "text", text: typeof output === "string" ? output : JSON.stringify(output) },
      ],
      usage: { input_tokens: 900, output_tokens: 300 },
    }) as unknown as Partial<Anthropic.Message>;
  const image = { mediaType: "image/png" as const, data: PNG.toString("base64") };

  it("사진 한 장과 JSON 스키마로, 토큰을 아끼는 설정으로 부른다", async () => {
    const { client, create } = fakeClient(reply(goodOutput));
    const r = await readCakePhoto(client, "claude-haiku-5-5", image);
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: PHOTO_READ_OUTPUT_SCHEMA },
    });
    expect(params.max_tokens).toBeLessThanOrEqual(1024);
    expect(params.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: image.data },
    });
    expect(params.system).toContain("사진 속 인물 그림");
    expect(r.result?.size).toBe("LUNCHBOX");
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 300 });
  });

  it("거절·출력 상한·형식이 틀린 응답·케이크 아님은 못 읽음", async () => {
    for (const response of [
      reply(goodOutput, "refusal"),
      reply(goodOutput, "max_tokens"),
      reply("케이크네요"),
      reply({ ...goodOutput, isCake: false }),
    ]) {
      const { client } = fakeClient(response);
      expect((await readCakePhoto(client, "claude-haiku-5-5", image)).result).toBeNull();
    }
  });

  it("출력 스키마는 모든 칸이 필수이고 다른 칸을 받지 않는다(구조화 출력 규칙)", () => {
    expect(PHOTO_READ_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(PHOTO_READ_OUTPUT_SCHEMA.required).toEqual(
      Object.keys(PHOTO_READ_OUTPUT_SCHEMA.properties),
    );
    expect(PHOTO_READ_OUTPUT_SCHEMA.properties.rows.required).toEqual([
      "shape",
      "creamColor",
      "border",
      "decoration",
      "lettering",
      "candlesToppers",
      "creamType",
    ]);
  });
});
