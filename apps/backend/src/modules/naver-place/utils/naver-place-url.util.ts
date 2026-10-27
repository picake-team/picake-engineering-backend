import {
  NAVER_PLACE_HOSTS,
  NAVER_SHORT_URL_HOST,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";

/** 플레이스 ID: 숫자만 (네이버는 7~12자리 정도를 쓴다) */
const PLACE_ID_REGEX = /^\d{5,15}$/;

/** URL 경로에서 `/place/{id}` 또는 `/{업종}/{id}` 형태의 ID를 찾는다 */
const PLACE_ID_IN_PATH_REGEX = /\/[a-z]+\/(\d{5,15})(?:\/|$)/;

/**
 * 입력 문자열을 URL로 해석한다. 스킴이 없으면 https를 붙인다.
 */
export function parseNaverUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/**
 * 네이버 지도 공유 단축 링크(naver.me)인지 확인한다.
 */
export function isNaverShortUrl(input: string): boolean {
  const url = parseNaverUrl(input);
  return url?.hostname === NAVER_SHORT_URL_HOST;
}

/**
 * 네이버 플레이스 링크(또는 숫자 ID)에서 플레이스 ID를 꺼낸다.
 * 단축 링크(naver.me)는 리다이렉트를 따라간 뒤의 URL로 다시 호출해야 한다.
 *
 * 지원 형태:
 * - 1855763938
 * - https://map.naver.com/p/entry/place/1855763938?lng=...
 * - https://map.naver.com/p/search/케이크/place/1855763938
 * - https://m.place.naver.com/restaurant/1855763938/home
 * - https://pcmap.place.naver.com/place/1855763938
 */
export function extractNaverPlaceId(input: string): string | null {
  const trimmed = input.trim();
  if (PLACE_ID_REGEX.test(trimmed)) return trimmed;

  const url = parseNaverUrl(trimmed);
  if (!url || !NAVER_PLACE_HOSTS.includes(url.hostname)) return null;

  const match = url.pathname.match(PLACE_ID_IN_PATH_REGEX);
  if (match) return match[1];

  // 예전 형식: https://m.map.naver.com/siteview.naver?code=123456
  const code = url.searchParams.get("code") ?? url.searchParams.get("id");
  return code && PLACE_ID_REGEX.test(code) ? code : null;
}
