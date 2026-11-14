import type { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { isValidDesignId } from "@apps/backend/common/constants/design-gallery.constants";
import {
  QUOTE_PHOTO_PARTS,
  type QuotePhotoDetail,
  type QuotePhotoPart,
} from "@apps/backend/modules/quote-request/constants/quote-request.constants";

/** 손님 사진 · 전체(이 칸이 생기기 전 요청과 정보 없이 온 사진) */
const defaultDetail = (): QuotePhotoDetail => ({ designId: null, parts: ["ALL"] });

function isPart(value: unknown): value is QuotePhotoPart {
  return typeof value === "string" && (QUOTE_PHOTO_PARTS as readonly string[]).includes(value);
}

/**
 * 따를 것 정리: ALL이 있으면 ALL만, 나머지는 겹치지 않게 모양·색·장식·글자 순서로.
 * 알 수 없는 값은 버리고, 남는 게 없으면 ALL
 */
export function normalizePhotoParts(parts: readonly unknown[]): QuotePhotoPart[] {
  const valid = parts.filter(isPart);
  if (valid.length === 0 || valid.includes("ALL")) return ["ALL"];
  return QUOTE_PHOTO_PARTS.filter((p) => p !== "ALL" && valid.includes(p));
}

/** 고른 디자인 ID(겹치지 않게, 사진 순서대로) */
export function designIdsOf(details: readonly QuotePhotoDetail[]): string[] {
  return [...new Set(details.map((d) => d.designId).filter((id): id is string => id !== null))];
}

/**
 * 요청서를 저장할 때의 사진 정보. 정보 없이 오면 사진마다 손님 사진 · 전체.
 * 개수가 사진과 다르면 null(부르는 쪽이 400으로 막는다)
 */
export function buildPhotoDetailsForCreate(
  photoCount: number,
  input: readonly { designId?: string | null; parts: readonly unknown[] }[] | undefined,
): { photoDetails: QuotePhotoDetail[]; designIds: string[] } | null {
  if (input === undefined) {
    return { photoDetails: Array.from({ length: photoCount }, defaultDetail), designIds: [] };
  }
  if (input.length !== photoCount) return null;
  const photoDetails = input.map((d) => ({
    designId: d.designId ?? null,
    parts: normalizePhotoParts(d.parts),
  }));
  return { photoDetails, designIds: designIdsOf(photoDetails) };
}

/**
 * 저장된 사진 정보를 보여 줄 모양으로(photoUrls와 같은 개수).
 * 이 칸이 생기기 전 요청([])이나 개수가 맞지 않는 값은 사진마다 손님 사진 · 전체로 본다
 */
export function readPhotoDetails(raw: Prisma.JsonValue, photoCount: number): QuotePhotoDetail[] {
  if (!Array.isArray(raw) || raw.length !== photoCount) {
    return Array.from({ length: photoCount }, defaultDetail);
  }
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return defaultDetail();
    const { designId, parts } = item as { designId?: unknown; parts?: unknown };
    return {
      designId: isValidDesignId(designId) ? designId : null,
      parts: normalizePhotoParts(Array.isArray(parts) ? parts : []),
    };
  });
}
