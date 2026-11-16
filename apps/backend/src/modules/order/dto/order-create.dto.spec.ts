import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import { CreateOrderItemDto } from "@apps/backend/modules/order/dto/order-create.dto";

/** 주문 항목 입력 한도(11-16 검토 — 소수 수량이 500, 요청사항 길이 제한 없음) */
describe("CreateOrderItemDto 한도", () => {
  const errorsOf = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(CreateOrderItemDto, plain))).map((e) => e.property);

  it("정상 수량·요청사항은 통과", async () => {
    expect(await errorsOf({ quantity: 2, requestMessage: "초 하나 넣어 주세요" })).toEqual([]);
  });

  it("소수·너무 큰 수량, 500자 넘는 요청사항은 거절(400)", async () => {
    expect(await errorsOf({ quantity: 1.5 })).toContain("quantity");
    expect(await errorsOf({ quantity: 1000 })).toContain("quantity");
    expect(await errorsOf({ quantity: 1, requestMessage: "가".repeat(501) })).toContain(
      "requestMessage",
    );
  });
});
