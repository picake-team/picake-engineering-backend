import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import { CreateTermsDocumentDto } from "./terms.dto";

/** 즉시 활성화는 참/거짓만(11-15 검토: 글자 "false"를 보내도 바로 활성화됐음) */
describe("CreateTermsDocumentDto.activateNow", () => {
  it("참/거짓이 아니면 막는다", async () => {
    const dto = plainToInstance(CreateTermsDocumentDto, { activateNow: "false" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "activateNow")).toBe(true);
  });

  it("true·false·빈 값은 받는다", async () => {
    for (const activateNow of [true, false, undefined]) {
      const dto = plainToInstance(CreateTermsDocumentDto, { activateNow });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === "activateNow")).toBe(false);
    }
  });
});
