import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";

import { rethrowRegisterUniqueConflict } from "./register-conflict.util";

const p2002 = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });

describe("rethrowRegisterUniqueConflict — 가입 저장 중 유니크 충돌을 409로", () => {
  it("번호 충돌이면 이미 사용 중인 번호", () => {
    expect(() => rethrowRegisterUniqueConflict(p2002(["phone"]), "X")).toThrow(
      new ConflictException(AUTH_ERROR_MESSAGES.PHONE_ALREADY_EXISTS),
    );
  });

  it("소셜 ID 충돌이면 넘긴 provider 문구", () => {
    expect(() =>
      rethrowRegisterUniqueConflict(
        p2002(["kakao_id"]),
        AUTH_ERROR_MESSAGES.KAKAO_ID_ALREADY_EXISTS,
      ),
    ).toThrow(new ConflictException(AUTH_ERROR_MESSAGES.KAKAO_ID_ALREADY_EXISTS));
  });

  it("다른 오류는 그대로 던진다", () => {
    const other = new Error("boom");
    expect(() => rethrowRegisterUniqueConflict(other, "X")).toThrow(other);
  });
});
