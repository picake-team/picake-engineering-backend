import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import {
  IsYmdDateString,
  isRealYmdDateString,
} from "@apps/backend/common/decorators/date-query.decorator";

class Q {
  @IsYmdDateString()
  startDate!: string;
}

describe("IsYmdDateString — 실제 있는 날짜만(11-16 검토, '2026-13-45'가 500이던 것)", () => {
  it("있는 날짜·윤일은 통과, 없는 날짜·모양이 다른 값은 거절", () => {
    expect(isRealYmdDateString("2026-11-16")).toBe(true);
    expect(isRealYmdDateString("2028-02-29")).toBe(true);
    expect(isRealYmdDateString("2026-13-45")).toBe(false);
    expect(isRealYmdDateString("2026-02-30")).toBe(false);
    expect(isRealYmdDateString("2026-1-1")).toBe(false);
  });

  it("데코레이터로 400 검증 오류가 난다", async () => {
    expect(await validate(plainToInstance(Q, { startDate: "2026-11-16" }))).toHaveLength(0);
    const errors = await validate(plainToInstance(Q, { startDate: "2026-13-45" }));
    expect(errors[0]?.constraints?.isYmdDateString).toBe("YYYY-MM-DD 형식이어야 합니다.");
  });
});
