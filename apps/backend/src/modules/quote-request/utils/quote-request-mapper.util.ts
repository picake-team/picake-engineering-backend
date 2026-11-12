import {
  Prisma,
  QuoteRequestCloseReason,
  QuoteRequestStatus,
} from "@apps/backend/infra/database/prisma/generated/client";
import type {
  QuoteRequestDetailDto,
  QuoteRequestListItemDto,
  QuoteRequestSummaryDto,
} from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import type {
  AdminQuoteRequestDetailDto,
  AdminQuoteRequestListItemDto,
} from "@apps/backend/modules/quote-request/dto/quote-request-admin.dto";
import {
  formatArea,
  formatBudget,
  formatCake,
  formatKstDateTime,
  formatPickup,
} from "@apps/backend/modules/quote-request/utils/quote-request-label.util";

export const QUOTE_REQUEST_STORE_SELECT = {
  id: true,
  storeId: true,
  kakaoPlaceId: true,
  name: true,
  address: true,
  addedBy: true,
  phone: true,
  placeUrl: true,
  latitude: true,
  longitude: true,
} satisfies Prisma.QuoteRequestStoreSelect;

export const QUOTE_REQUEST_SELECT = {
  id: true,
  status: true,
  closeReason: true,
  closedAt: true,
  pickupDate: true,
  pickupHourFrom: true,
  pickupHourTo: true,
  pickupStartAt: true,
  deadlineAt: true,
  areaName: true,
  areaSido: true,
  areaLatitude: true,
  areaLongitude: true,
  distanceKm: true,
  onlyDesignatedStores: true,
  description: true,
  photoUrls: true,
  size: true,
  quantity: true,
  creams: true,
  flavorNote: true,
  budgetMin: true,
  budgetMax: true,
  requestNote: true,
  entry: true,
  createdAt: true,
  chosenTargetId: true,
  stores: { select: QUOTE_REQUEST_STORE_SELECT, orderBy: { sortOrder: "asc" } },
  quotes: { select: { consumerSeenAt: true } },
} satisfies Prisma.QuoteRequestSelect;

export const ADMIN_QUOTE_REQUEST_SELECT = {
  ...QUOTE_REQUEST_SELECT,
  consumer: { select: { id: true, nickname: true, name: true, phone: true } },
} satisfies Prisma.QuoteRequestSelect;

export type QuoteRequestRow = Prisma.QuoteRequestGetPayload<{
  select: typeof QUOTE_REQUEST_SELECT;
}>;
export type AdminQuoteRequestRow = Prisma.QuoteRequestGetPayload<{
  select: typeof ADMIN_QUOTE_REQUEST_SELECT;
}>;

/** 마감이 지났는데 아직 OPEN이면 마감(EXPIRED)으로 본다(마감 처리 배치를 기다리지 않음) */
export function effectiveStatus(
  row: Pick<QuoteRequestRow, "status" | "closeReason" | "deadlineAt">,
  now: Date,
): { status: QuoteRequestStatus; closeReason: QuoteRequestCloseReason | null } {
  if (row.status === QuoteRequestStatus.OPEN && row.deadlineAt.getTime() <= now.getTime()) {
    return { status: QuoteRequestStatus.CLOSED, closeReason: QuoteRequestCloseReason.EXPIRED };
  }
  return { status: row.status, closeReason: row.closeReason };
}

/** 견적 받는 중이고 마감 전(동시에 열어 둘 수 있는 요청 수를 셀 때) */
export function ongoingWhere(now: Date): Prisma.QuoteRequestWhereInput {
  return { status: QuoteRequestStatus.OPEN, deadlineAt: { gt: now } };
}

/** 손님 "진행 중" 탭: 받는 중이거나, 가게를 고른 뒤 픽업 다음 날까지(기획 I-46 ②) */
export function consumerInProgressWhere(now: Date): Prisma.QuoteRequestWhereInput {
  return {
    OR: [
      ongoingWhere(now),
      {
        status: QuoteRequestStatus.CONNECTED,
        pickupStartAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    ],
  };
}

/** 관리자 상태 필터(마감이 지난 OPEN은 CLOSED로) */
export function adminStatusWhere(
  status: QuoteRequestStatus | undefined,
  now: Date,
): Prisma.QuoteRequestWhereInput {
  if (status === QuoteRequestStatus.OPEN) return ongoingWhere(now);
  if (status === QuoteRequestStatus.CLOSED) {
    return {
      OR: [
        { status: QuoteRequestStatus.CLOSED },
        { status: QuoteRequestStatus.OPEN, deadlineAt: { lte: now } },
      ],
    };
  }
  if (status === QuoteRequestStatus.CONNECTED) return { status: QuoteRequestStatus.CONNECTED };
  return {};
}

export function buildSummary(row: QuoteRequestRow): QuoteRequestSummaryDto {
  return {
    pickup: formatPickup(row),
    area: formatArea({ ...row, onlyStoreName: row.stores[0]?.name ?? null }),
    cake: formatCake(row),
    budget: formatBudget(row),
    deadline: formatKstDateTime(row.deadlineAt),
  };
}

export function toListItem(row: QuoteRequestRow, now: Date): QuoteRequestListItemDto {
  const { status, closeReason } = effectiveStatus(row, now);
  return {
    id: row.id,
    status,
    closeReason,
    pickupDate: row.pickupDate,
    pickupHourFrom: row.pickupHourFrom,
    pickupHourTo: row.pickupHourTo,
    pickupStartAt: row.pickupStartAt,
    deadlineAt: row.deadlineAt,
    size: row.size,
    quantity: row.quantity,
    thumbnailUrl: row.photoUrls[0] ?? null,
    quoteCount: row.quotes.length,
    unseenQuoteCount: row.quotes.filter((q) => !q.consumerSeenAt).length,
    chosen: !!row.chosenTargetId,
    summary: buildSummary(row),
    createdAt: row.createdAt,
  };
}

export function toDetail(row: QuoteRequestRow, now: Date): QuoteRequestDetailDto {
  return {
    ...toListItem(row, now),
    description: row.description,
    photoUrls: row.photoUrls,
    creams: row.creams,
    flavorNote: row.flavorNote,
    budgetMin: row.budgetMin,
    budgetMax: row.budgetMax,
    requestNote: row.requestNote,
    onlyDesignatedStores: row.onlyDesignatedStores,
    areaName: row.areaName,
    areaSido: row.areaSido,
    distanceKm: row.distanceKm,
    closedAt: row.closedAt,
    stores: row.stores.map((s) => ({
      id: s.id,
      storeId: s.storeId,
      kakaoPlaceId: s.kakaoPlaceId,
      name: s.name,
      address: s.address,
      isPicakeStore: s.storeId !== null,
    })),
  };
}

export function toAdminListItem(
  row: AdminQuoteRequestRow,
  now: Date,
): AdminQuoteRequestListItemDto {
  return {
    ...toListItem(row, now),
    storeCount: row.stores.length,
    photoCount: row.photoUrls.length,
    entry: row.entry,
  };
}

export function toAdminDetail(row: AdminQuoteRequestRow, now: Date): AdminQuoteRequestDetailDto {
  return {
    ...toDetail(row, now),
    stores: row.stores.map((s) => ({
      id: s.id,
      storeId: s.storeId,
      kakaoPlaceId: s.kakaoPlaceId,
      name: s.name,
      address: s.address,
      isPicakeStore: s.storeId !== null,
      addedBy: s.addedBy,
      phone: s.phone,
      placeUrl: s.placeUrl,
      latitude: s.latitude,
      longitude: s.longitude,
    })),
    consumer: row.consumer,
    areaLatitude: row.areaLatitude,
    areaLongitude: row.areaLongitude,
    entry: row.entry,
  };
}
