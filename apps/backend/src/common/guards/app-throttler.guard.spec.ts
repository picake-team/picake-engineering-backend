import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerException, type ThrottlerLimitDetail } from "@nestjs/throttler";
import { ThrottleMessage } from "@apps/backend/common/decorators/throttle-message.decorator";
import { AppThrottlerGuard } from "@apps/backend/common/guards/app-throttler.guard";

class Routes {
  @ThrottleMessage("잠시 후 다시 시도해 주세요.")
  withMessage() {}

  plain() {}
}

function contextFor(handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Routes,
  } as unknown as ExecutionContext;
}

describe("AppThrottlerGuard(분당 요청 수 제한의 429 안내 글)", () => {
  const guard = new AppThrottlerGuard([{ ttl: 60000, limit: 10 }], {} as never, new Reflector());
  const detail = {} as ThrottlerLimitDetail;
  const throwFor = (handler: () => void) =>
    (
      guard as unknown as {
        throwThrottlingException: (c: ExecutionContext, d: ThrottlerLimitDetail) => Promise<void>;
      }
    )
      .throwThrottlingException(contextFor(handler), detail)
      .then(
        () => null,
        (e: unknown) => e,
      );

  it("@ThrottleMessage를 붙인 경로는 그 글을 data.message로(429)", async () => {
    const error = await throwFor(Routes.prototype.withMessage);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({
      message: "잠시 후 다시 시도해 주세요.",
      error: "Too Many Requests",
      statusCode: 429,
    });
  });

  it("붙이지 않은 경로는 지금처럼 라이브러리 기본 글 그대로", async () => {
    const error = await throwFor(Routes.prototype.plain);
    expect(error).toBeInstanceOf(ThrottlerException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toBe("ThrottlerException: Too Many Requests");
  });
});
