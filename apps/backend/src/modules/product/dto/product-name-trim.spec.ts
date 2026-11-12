import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { UpdateProductRequestDto } from "./product-update.dto";

describe("상품명 앞뒤 공백", () => {
  it("고칠 때 앞뒤 공백은 지우고, 공백만 있는 이름은 막는다", async () => {
    const ok = plainToInstance(UpdateProductRequestDto, { name: "  딸기 케이크 " });
    expect(ok.name).toBe("딸기 케이크");
    expect((await validate(ok)).filter((e) => e.property === "name")).toHaveLength(0);

    const blank = plainToInstance(UpdateProductRequestDto, { name: "   " });
    expect((await validate(blank)).some((e) => e.property === "name")).toBe(true);

    const none = plainToInstance(UpdateProductRequestDto, {});
    expect((await validate(none)).some((e) => e.property === "name")).toBe(false);
  });
});
