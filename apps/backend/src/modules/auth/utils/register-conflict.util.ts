import { ConflictException } from "@nestjs/common";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";

/**
 * 가입 저장 중 유니크 충돌(P2002)을 409로 바꾼다(11-16 검토). 앞의 중복 확인을 통과한 뒤에도
 * 같은 가입표를 거의 동시에 두 번 보내거나(두 번 누르기) 그사이 같은 번호로 다른 가입이 끝나면 저장에서 충돌한다 — 그대로 두면 500.
 * 번호 충돌이면 "이미 사용 중인 휴대폰 번호", 그 밖(소셜 ID)이면 provider별 "이미 사용 중인 계정".
 */
export function rethrowRegisterUniqueConflict(
  error: unknown,
  providerIdExistsMessage: string,
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = JSON.stringify((error.meta as { target?: unknown } | undefined)?.target ?? "");
    throw new ConflictException(
      target.includes("phone") ? AUTH_ERROR_MESSAGES.PHONE_ALREADY_EXISTS : providerIdExistsMessage,
    );
  }
  throw error;
}
