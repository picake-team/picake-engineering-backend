import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { BusinessValidationRequestDto } from "./business-request.dto";

describe("사업자 확인 입력 앞뒤 공백", () => {
  it("휴대폰 자판이 붙인 공백을 지운 뒤 국세청 확인에 보낸다", async () => {
    const dto = plainToInstance(BusinessValidationRequestDto, {
      b_no: " 1234567890 ",
      start_dt: "20200101 ",
      p_nm: "홍길동 ",
      b_nm: " 달콤케이크",
    });
    expect(dto.p_nm).toBe("홍길동");
    expect(dto.b_nm).toBe("달콤케이크");
    expect(dto.start_dt).toBe("20200101");
    expect(dto.b_no).toBe("1234567890");
    const errors = await validate(dto);
    expect(errors.filter((e) => ["p_nm", "b_nm", "start_dt"].includes(e.property))).toHaveLength(0);
  });
});
