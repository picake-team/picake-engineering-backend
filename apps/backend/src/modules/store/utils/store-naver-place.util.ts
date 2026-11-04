import { StoreNaverPlaceDto } from "@apps/backend/modules/store/dto/store-detail.dto";

/**
 * 스토어의 네이버 플레이스 연결 정보를 응답 형태로 바꾼다. 연결하지 않았으면 null.
 */
export function toStoreNaverPlace(store: {
  naverPlaceId: string | null;
  naverPlaceConnectedAt: Date | null;
}): StoreNaverPlaceDto | null {
  if (!store.naverPlaceId) return null;
  return {
    placeId: store.naverPlaceId,
    placeUrl: `https://map.naver.com/p/entry/place/${store.naverPlaceId}`,
    connectedAt: store.naverPlaceConnectedAt ?? new Date(0),
  };
}
