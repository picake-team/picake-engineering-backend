import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";

import { ActAsOtpGuard } from "./act-as-otp-guard.util";

// 들어가기 OTP: 관리자마다 15분에 5번 틀리면 15분 막고, 한 번 쓴 코드는 90초 동안 다시 받지 않는다(11-18 검토)
describe("ActAsOtpGuard", () => {
  const MIN = 60 * 1000;

  it("5번째 틀림에서 막히고(알림 정보를 돌려줌) 막힌 동안은 시작 자체가 안 된다", () => {
    let t = 0;
    const g = new ActAsOtpGuard(() => t);
    for (let i = 0; i < 4; i++) expect(g.recordFailure("a1")).toBeNull();
    const locked = g.recordFailure("a1");
    expect(locked?.failures).toBe(5);
    expect(() => g.assertNotLocked("a1")).toThrow(ACT_AS_ERROR_MESSAGES.OTP_LOCKED);
    // 다른 관리자는 상관없다
    expect(() => g.assertNotLocked("a2")).not.toThrow();
    t += 15 * MIN + 1;
    expect(() => g.assertNotLocked("a1")).not.toThrow();
    // 풀린 뒤에는 처음부터 다시 센다
    expect(g.recordFailure("a1")).toBeNull();
  });

  it("15분이 지나면 틀린 횟수를 처음부터 센다", () => {
    let t = 0;
    const g = new ActAsOtpGuard(() => t);
    for (let i = 0; i < 4; i++) g.recordFailure("a1");
    t += 16 * MIN;
    expect(g.recordFailure("a1")).toBeNull();
  });

  it("맞는 코드를 쓰면 틀린 횟수를 지우고, 같은 코드는 90초 동안 다시 받지 않는다", () => {
    let t = 0;
    const g = new ActAsOtpGuard(() => t);
    for (let i = 0; i < 4; i++) g.recordFailure("a1");
    g.consume("a1", "123456");
    expect(g.recordFailure("a1")).toBeNull(); // 다시 1번째
    expect(() => g.consume("a1", "123456")).toThrow(BadRequestException);
    expect(() => g.consume("a1", "123456")).toThrow(ACT_AS_ERROR_MESSAGES.OTP_REUSED);
    expect(() => g.consume("a2", "123456")).not.toThrow(); // 다른 관리자
    t += 91 * 1000;
    expect(() => g.consume("a1", "123456")).not.toThrow();
  });
});
