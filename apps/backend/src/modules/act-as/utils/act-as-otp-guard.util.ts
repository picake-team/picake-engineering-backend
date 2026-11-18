import { BadRequestException } from "@nestjs/common";

import {
  ACT_AS_ERROR_MESSAGES,
  ACT_AS_LIMITS,
} from "@apps/backend/modules/act-as/constants/act-as.constants";

/**
 * 가게 대신 입력 들어가기 OTP 지키기(기획 I-41, 11-18 검토).
 * 관리자 출입증(30일)이 새도 대리 접속까지 열리지 않게 OTP를 다시 받는데, 지금까지는 접속 주소마다 분당 10번만 막아
 * 주소를 바꿔 가며 코드를 맞힐 수 있었고, 맞힌 코드를 90초쯤 다시 써 세션을 여러 개 열 수 있었다.
 * - 관리자마다 15분 안에 5번 틀리면 15분 막는다(막힌 동안은 맞는 코드도 받지 않는다). 막힐 때 한 번 운영 알림.
 * - 한 번 쓴 코드는 90초 동안 다시 받지 않는다.
 * 서버는 pm2 한 프로세스라 메모리에 둔다(다시 켜면 처음부터 — 막힌 사람이 풀리는 쪽이라 괜찮다).
 */
export class ActAsOtpGuard {
  private readonly failures = new Map<
    string,
    { count: number; firstAt: number; lockedUntil?: number }
  >();
  private readonly used = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private get windowMs() {
    return ACT_AS_LIMITS.OTP_FAIL_WINDOW_MINUTES * 60 * 1000;
  }

  /** 막혀 있으면 400(맞는 코드여도) */
  assertNotLocked(adminId: string): void {
    const f = this.failures.get(adminId);
    if (f?.lockedUntil && f.lockedUntil > this.now()) {
      throw new BadRequestException(ACT_AS_ERROR_MESSAGES.OTP_LOCKED);
    }
  }

  /** 틀림 하나. 이번에 막히게 됐으면 { failures, until }을 돌려준다(알림은 그때 한 번) */
  recordFailure(adminId: string): { failures: number; until: Date } | null {
    const t = this.now();
    const prev = this.failures.get(adminId);
    const fresh = !prev || t - prev.firstAt > this.windowMs || (prev.lockedUntil ?? 0) > 0;
    const f = fresh ? { count: 1, firstAt: t } : { ...prev, count: prev.count + 1 };
    if (f.count >= ACT_AS_LIMITS.OTP_FAIL_MAX) {
      const until = t + this.windowMs;
      this.failures.set(adminId, { ...f, lockedUntil: until });
      return { failures: f.count, until: new Date(until) };
    }
    this.failures.set(adminId, f);
    return null;
  }

  /** 맞는 코드를 썼다. 방금 쓴 코드면 400, 아니면 기억하고 틀린 횟수를 지운다 */
  consume(adminId: string, code: string): void {
    const t = this.now();
    for (const [k, at] of this.used) {
      if (t - at > ACT_AS_LIMITS.OTP_REUSE_SECONDS * 1000) this.used.delete(k);
    }
    const key = `${adminId}:${code}`;
    if (this.used.has(key)) throw new BadRequestException(ACT_AS_ERROR_MESSAGES.OTP_REUSED);
    this.used.set(key, t);
    this.failures.delete(adminId);
  }
}
