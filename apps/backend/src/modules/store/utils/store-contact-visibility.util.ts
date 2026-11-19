import type { Prisma } from "@apps/backend/infra/database/prisma/generated/client";

/**
 * 손님 문의 "손님에게 보이기"(기획 I-01, 운영자 2026-11-19).
 * 사장님이 채팅·카톡 채널·인스타·전화를 하나씩 켜고 끈다. 값(카톡·인스타·전화)이 있어도 꺼 두면 손님에게 보내지 않는다.
 * 모두 꺼지면 손님 화면의 문의 버튼(상품·가게 화면)이 사라진다. 예약한 손님의 주문 화면 채팅은 끌 수 없다(chat.service).
 */
export type StoreContactVisibility = {
  chatInquiryVisible: boolean;
  kakaoChannelVisible: boolean;
  instagramVisible: boolean;
  phoneVisible: boolean;
};

const KEYS = [
  "chatInquiryVisible",
  "kakaoChannelVisible",
  "instagramVisible",
  "phoneVisible",
] as const satisfies readonly (keyof StoreContactVisibility)[];

export const STORE_CONTACT_VISIBILITY_SELECT = {
  chatInquiryVisible: true,
  kakaoChannelVisible: true,
  instagramVisible: true,
  phoneVisible: true,
} as const satisfies Prisma.StoreSelect;

/** 요청 DTO에서 보낸 스위치만 골라 저장 값으로(보내지 않은 것은 그대로 둔다) */
export function pickContactVisibility(
  dto: Partial<Record<keyof StoreContactVisibility, unknown>>,
): Partial<StoreContactVisibility> {
  const out: Partial<StoreContactVisibility> = {};
  for (const key of KEYS) {
    const value = dto[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** 손님에게 보낼 연락처: 꺼 둔 것은 null */
export function customerVisibleContacts(
  store: {
    phoneNumber: string | null;
    kakaoChannelId: string | null;
    instagramId: string | null;
  } & Partial<StoreContactVisibility>,
): { phoneNumber: string | null; kakaoChannelId: string | null; instagramId: string | null } {
  // 칸이 없던 행(옛 select)은 켜진 것으로 본다(DB 기본값과 같게)
  const on = (v: boolean | undefined) => v !== false;
  return {
    phoneNumber: on(store.phoneVisible) ? (store.phoneNumber ?? null) : null,
    kakaoChannelId: on(store.kakaoChannelVisible) ? (store.kakaoChannelId ?? null) : null,
    instagramId: on(store.instagramVisible) ? (store.instagramId ?? null) : null,
  };
}
