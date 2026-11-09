import { ArgumentsHost, BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SentryUtil } from "@apps/backend/common/utils/sentry.util";

import { ErrorResponseInterceptor } from "./error-response.interceptor";

function buildHost(request: Record<string, unknown>) {
  const response = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe("ErrorResponseInterceptor", () => {
  const filter = new ErrorResponseInterceptor();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("5xx는 Sentry에 보내고 어느 API인지(method·route 패턴) 태그로 붙인다", () => {
    const capture = vi.spyOn(SentryUtil, "captureException").mockImplementation(() => undefined);
    const { host, response } = buildHost({
      method: "POST",
      url: "/v1/consumer/orders/abc?phone=01012345678",
      route: { path: "/v1/consumer/orders/:id" },
    });

    filter.catch(new Error("db failed"), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(capture).toHaveBeenCalledWith(expect.any(Error), "error", {
      responseId: expect.any(String),
      method: "POST",
      route: "/v1/consumer/orders/:id",
    });
  });

  it("경로가 매칭되지 않은 요청은 route를 unmatched로 둔다(실제 주소를 넣지 않음)", () => {
    const capture = vi.spyOn(SentryUtil, "captureException").mockImplementation(() => undefined);
    const { host } = buildHost({ method: "GET", url: "/v1/unknown/01012345678" });

    filter.catch(new Error("boom"), host);

    expect(capture).toHaveBeenCalledWith(
      expect.any(Error),
      "error",
      expect.objectContaining({ route: "unmatched" }),
    );
  });

  it("4xx는 Sentry에 보내지 않는다", () => {
    const capture = vi.spyOn(SentryUtil, "captureException").mockImplementation(() => undefined);
    const { host, response } = buildHost({ method: "GET", url: "/v1/x" });

    filter.catch(new BadRequestException("bad"), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(capture).not.toHaveBeenCalled();
  });
});
