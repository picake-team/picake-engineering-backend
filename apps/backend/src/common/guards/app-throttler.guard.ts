import { ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import { THROTTLE_MESSAGE_KEY } from "@apps/backend/common/decorators/throttle-message.decorator";

/**
 * 전역 요청 수 제한 Guard(`ThrottlerGuard` 그대로 + 경로별 안내 글).
 * `@ThrottleMessage(글)`을 붙인 경로만 429에 그 글을 `{ message }`로 보내고, 나머지는 기본 동작 그대로다
 * (기본 글을 비교하는 곳이 있을 수 있어 전역 글은 바꾸지 않는다).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const message = this.reflector.getAllAndOverride<string | undefined>(THROTTLE_MESSAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!message) {
      return super.throwThrottlingException(context, throttlerLimitDetail);
    }
    throw new HttpException(
      { message, error: "Too Many Requests", statusCode: HttpStatus.TOO_MANY_REQUESTS },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
