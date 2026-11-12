import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";

import { CreateStoreRequestDto } from "./store-create.dto";
import { UpdateStoreRequestDto } from "./store-update.dto";

describe("가게 이름 앞뒤 공백", () => {
  it("만들 때·고칠 때 앞뒤 공백 없이 저장한다(검사도 공백을 뺀 값으로 함)", () => {
    expect(plainToInstance(CreateStoreRequestDto, { name: "몽이누나네 " }).name).toBe("몽이누나네");
    expect(plainToInstance(UpdateStoreRequestDto, { name: " 몽이누나네" }).name).toBe("몽이누나네");
  });
});
