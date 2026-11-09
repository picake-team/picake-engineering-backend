import type { ErrorEvent } from "@sentry/nestjs";
import * as Sentry from "@sentry/nestjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SentryUtil } from "./sentry.util";

vi.mock("@sentry/nestjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn(async () => true),
}));

describe("SentryUtil.scrubText", () => {
  it("이메일은 앞뒤 일부만 남기고 가린다", () => {
    expect(SentryUtil.scrubText("duplicate: someone@example.com")).toBe(
      "duplicate: so***ne@example.com",
    );
  });

  it("휴대폰 번호는 하이픈이 있든 없든 가운데를 가린다", () => {
    expect(SentryUtil.scrubText('phone: "01012345678"')).toBe('phone: "010-****-5678"');
    expect(SentryUtil.scrubText("tel 010-1234-5678 end")).toBe("tel 010-****-5678 end");
  });

  it("Bearer 토큰을 가린다", () => {
    expect(SentryUtil.scrubText("Authorization: Bearer abc.def-ghi")).toBe(
      "Authorization: Bearer ****",
    );
  });

  it("주문번호·날짜 같은 다른 숫자는 그대로 둔다", () => {
    const text = "order 20261109-0001 failed at 2026-11-09";
    expect(SentryUtil.scrubText(text)).toBe(text);
  });
});

describe("SentryUtil.scrubEvent", () => {
  it("예외 메시지·메시지·extra·breadcrumb의 개인정보를 가린다", () => {
    const event = {
      message: "user someone@example.com",
      exception: { values: [{ type: "Error", value: "Invalid input phone: 01012345678" }] },
      extra: {
        phone: "01099998888",
        nested: { note: "contact me@example.com" },
        count: 3,
      },
      breadcrumbs: [{ message: "Bearer secret-token" }],
    } as unknown as ErrorEvent;

    const scrubbed = SentryUtil.scrubEvent(event);

    expect(scrubbed.message).toBe("user so***ne@example.com");
    expect(scrubbed.exception?.values?.[0]?.value).toBe("Invalid input phone: 010-****-5678");
    expect(scrubbed.extra).toEqual({
      phone: "010-****-8888",
      nested: { note: "contact m***@example.com" },
      count: 3,
    });
    expect(scrubbed.breadcrumbs?.[0]?.message).toBe("Bearer ****");
  });
});

describe("SentryUtil.captureExceptionThrottled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
    vi.mocked(Sentry.captureException).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("같은 key는 간격 안에 한 번만 보내고, 간격이 지나면 다시 보낸다", () => {
    const error = new Error("db down");

    expect(SentryUtil.captureExceptionThrottled("k1", 60_000, error, "error")).toBe(true);
    vi.setSystemTime(new Date("2026-11-09T00:00:30Z"));
    expect(SentryUtil.captureExceptionThrottled("k1", 60_000, error, "error")).toBe(false);
    vi.setSystemTime(new Date("2026-11-09T00:01:00Z"));
    expect(SentryUtil.captureExceptionThrottled("k1", 60_000, error, "error")).toBe(true);

    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("key가 다르면 따로 센다", () => {
    const error = new Error("boom");
    expect(SentryUtil.captureExceptionThrottled("k2", 60_000, error, "error")).toBe(true);
    expect(SentryUtil.captureExceptionThrottled("k3", 60_000, error, "error")).toBe(true);
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });
});

describe("SentryUtil.flush", () => {
  it("보내지 못한 이벤트를 기다린다", async () => {
    await SentryUtil.flush(1000);
    expect(Sentry.flush).toHaveBeenCalledWith(1000);
  });
});
