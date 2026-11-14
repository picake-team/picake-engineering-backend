import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

// Claude는 부르지 않는다: SDK 클라이언트를 가짜로 바꾼다(만들 때 받은 설정도 남긴다)
const { create, clientOptions } = vi.hoisted(() => ({
  create: vi.fn(),
  clientOptions: [] as unknown[],
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create };
    constructor(options: unknown) {
      clientOptions.push(options);
    }
  },
}));

import { ExternalApiErrorUtil } from "@apps/backend/common/utils/external-api-error.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { QuotePhotoReadService } from "@apps/backend/modules/quote-request/services/quote-photo-read.service";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const IMAGE = `data:image/jpeg;base64,${JPEG.toString("base64")}`;
const OUTPUT = {
  isCake: true,
  parts: {
    shape: "하트 모양 케이크",
    color: "연분홍",
    decoration: "딸기 3개",
    lettering: '"지민아 생일 축하해" 흰 글씨',
  },
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
    clientOptions.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** 수백 번 부르는 테스트에서 로그·오류 보고를 조용히 */
  function quiet() {
    vi.spyOn(LoggerUtil, "log").mockImplementation(() => undefined);
    vi.spyOn(ExternalApiErrorUtil, "reportFailure").mockImplementation(() => undefined);
    return vi.spyOn(SentryUtil, "captureExceptionThrottled").mockReturnValue(true);
  }

  it("읽은 값을 돌려준다", async () => {
    const r = await build().read(IMAGE, { consumerId: "c1" });
    expect(r).toEqual({
      parts: OUTPUT.parts,
      size: null,
      creams: [],
      requestNote: "",
    });
  });

  it("케이크가 아니면 { unreadable: true }만", async () => {
    create.mockResolvedValue(reply({ ...OUTPUT, isCake: false }));
    expect(await build().read(IMAGE, { ip: "1.1.1.1" })).toEqual({ unreadable: true });
    create.mockResolvedValue(reply(OUTPUT, "refusal"));
    expect(await build().read(IMAGE, { ip: "1.1.1.1" })).toEqual({ unreadable: true });
  });

  it("키가 없으면 503, 사진이 아니면 400(Claude를 부르지 않고 횟수도 세지 않음)", async () => {
    await expect(build("").read(IMAGE, { ip: "1.1.1.1" })).rejects.toThrow(
      new ServiceUnavailableException("지금은 사진을 읽을 수 없어요. 직접 적어 주세요."),
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
    await expect(service.read(IMAGE, { ip: "1.1.1.1" })).resolves.toHaveProperty("parts");
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
    // 다른 오류처럼 data.message로 온다(분당 한도의 "잠시 후 다시 시도해 주세요."와 글로 구분)
    const error = await service.read(IMAGE, { consumerId: "c1" }).catch((e: HttpException) => e);
    expect((error as HttpException).getResponse()).toEqual({
      message: "오늘은 사진 읽기를 다 썼어요. 직접 적어 주세요.",
      error: "Too Many Requests",
      statusCode: 429,
    });
    // 같은 주소라도 로그인하지 않은 요청은 주소로 센다(손님 한도와 따로)
    await expect(service.read(IMAGE, { ip: "1.1.1.1" })).resolves.toHaveProperty("parts");
    await expect(service.read(IMAGE, { consumerId: "c2" })).resolves.toHaveProperty("parts");

    for (let i = 0; i < 19; i += 1) await service.read(IMAGE, { ip: "1.1.1.1" });
    await expect(service.read(IMAGE, { ip: "1.1.1.1" })).rejects.toMatchObject({ status: 429 });
    await expect(service.read(IMAGE, { ip: "3.3.3.3" })).resolves.toHaveProperty("parts");
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
    await expect(service.read(IMAGE, { ip: "9.9.9.9" })).resolves.toHaveProperty("parts");
    await expect(service.read(IMAGE, { ip: "9.9.9.9" })).rejects.toMatchObject({ status: 429 });
  });

  it("접속 주소로 셀 때 IPv6는 /64로 묶고, IPv6 모양의 IPv4는 IPv4로 본다", async () => {
    quiet();
    const service = build();
    // 같은 /64 안에서 주소를 바꿔 가며 불러도 한 줄로 센다
    for (let i = 0; i < 20; i += 1) {
      await service.read(IMAGE, { ip: `2001:db8:1:2::${(i + 1).toString(16)}` });
    }
    await expect(
      service.read(IMAGE, { ip: "2001:db8:1:2:ffff:ffff:ffff:ffff" }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(service.read(IMAGE, { ip: "2001:db8:1:3::1" })).resolves.toHaveProperty("parts");

    for (let i = 0; i < 20; i += 1) await service.read(IMAGE, { ip: "198.51.100.4" });
    await expect(service.read(IMAGE, { ip: "::ffff:198.51.100.4" })).rejects.toMatchObject({
      status: 429,
    });
  });

  it("모든 손님을 합쳐 하루 1,000번: 넘으면 키가 없을 때와 같은 503, 그 손님 몫은 세지 않고 Sentry에 알린다", async () => {
    const sentry = quiet();
    const service = build();
    // 실패한 번은 전체 한도에서도 되돌린다: 10번 실패해도 1,000번을 다 쓴다
    create.mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 529 }));
    for (let i = 0; i < 10; i += 1) {
      create.mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 529 }));
    }
    for (let i = 0; i < 11; i += 1) {
      await expect(service.read(IMAGE, { ip: "10.0.0.1" })).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    }
    for (let n = 0; n < 50; n += 1) {
      for (let i = 0; i < 20; i += 1) await service.read(IMAGE, { ip: `10.1.0.${n}` });
    }
    expect(create).toHaveBeenCalledTimes(11 + 1000);
    expect(sentry).not.toHaveBeenCalled();

    // 오늘 아직 안 쓴 손님도 막힌다. 그 손님 몫은 쓰지 않은 것으로 되돌려 25번 불러도 429가 아니라 503
    for (let i = 0; i < 25; i += 1) {
      await expect(service.read(IMAGE, { consumerId: "late" })).rejects.toThrow(
        new ServiceUnavailableException("지금은 사진을 읽을 수 없어요. 직접 적어 주세요."),
      );
    }
    expect(create).toHaveBeenCalledTimes(11 + 1000);
    expect(sentry).toHaveBeenCalledWith(
      "quote-photo-read:daily-total",
      expect.any(Number),
      expect.any(Error),
      "warning",
      expect.objectContaining({ operation: "photo-read" }),
    );

    // 한국 시간 자정이 지나면 다시 쓴다
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 3_600_000);
    await expect(service.read(IMAGE, { consumerId: "late" })).resolves.toHaveProperty("parts");
  });

  it("Claude를 다시 시도하지 않고 25초 안에 끊는다(웹은 30초 기다림)", () => {
    build();
    expect(clientOptions).toHaveLength(1);
    const options = clientOptions[0] as { maxRetries: number; timeout: number };
    expect(options.maxRetries).toBe(0);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(25_000);
  });

  it("응답이 늦으면 마감에 끊고 502, 그 번은 세지 않는다", async () => {
    quiet();
    const service = build();
    const timeout = (clientOptions[0] as { timeout: number }).timeout;
    for (let i = 0; i < 19; i += 1) await service.read(IMAGE, { ip: "8.8.4.4" });

    vi.useFakeTimers();
    // 마감(signal)이 끊길 때까지 답하지 않는 Claude
    create.mockImplementationOnce(
      (_body: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("Request was aborted.")),
          );
        }),
    );
    const slow = service.read(IMAGE, { ip: "8.8.4.4" });
    const settled = slow.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(await Promise.race([settled, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBeInstanceOf(BadGatewayException);
    vi.useRealTimers();

    // 끊긴 번은 세지 않아 한 번 더 쓸 수 있다
    await expect(service.read(IMAGE, { ip: "8.8.4.4" })).resolves.toHaveProperty("parts");
    await expect(service.read(IMAGE, { ip: "8.8.4.4" })).rejects.toMatchObject({ status: 429 });
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
