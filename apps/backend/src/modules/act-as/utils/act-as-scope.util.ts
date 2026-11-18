import { ForbiddenException } from "@nestjs/common";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import type { ActAsActor } from "@apps/backend/modules/auth/types/auth.types";

type MaybeActor = { actor?: ActAsActor } | undefined;

/**
 * 운영자 대신 입력(기획 I-41) 중이면 들어간 가게의 것만 다룬다.
 * 가드는 주소·쿼리·본문의 storeId만 보므로, 상품 id·주문 id로 부르는 경로는 서비스가 찾은 행의 가게로 여기서 막는다
 * (사장님이 가게를 여럿 가진 경우 다른 가게 상품·주문을 고치거나 보지 않게).
 */
export function assertActAsStore(user: MaybeActor, storeId: string): void {
  if (user?.actor && user.actor.storeId !== storeId) {
    throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACT_AS_OTHER_STORE);
  }
}

/** 목록에서 고를 가게 조건: 대리 입력 중이면 들어간 가게 하나, 아니면 조건 없음 */
export function actAsStoreWhere(user: MaybeActor): { id?: string } {
  return user?.actor ? { id: user.actor.storeId } : {};
}
