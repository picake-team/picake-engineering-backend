import { SetMetadata } from "@nestjs/common";

export const THROTTLE_MESSAGE_KEY = "picake:throttle-message";

/**
 * 이 경로의 분당 요청 수 제한(`@Throttle`)에 걸렸을 때(429) 보낼 안내 글.
 * 붙인 경로는 다른 오류처럼 `data.message`에 이 글이 오고, 붙이지 않은 경로는 지금처럼 라이브러리 기본 글
 * ("ThrottlerException: Too Many Requests")이 그대로 간다(`AppThrottlerGuard`).
 *
 * 같은 경로에 하루 한도처럼 다른 429가 있으면 그것과 다른 글을 써서 웹이 구분해 알릴 수 있게 한다.
 */
export const ThrottleMessage = (message: string) => SetMetadata(THROTTLE_MESSAGE_KEY, message);
