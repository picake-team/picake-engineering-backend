/**
 * 네이버 플레이스 상세 페이지 (모바일). `{placeId}` 자리에 플레이스 ID를 넣는다.
 * 업종(restaurant, hairshop 등)이 달라도 `/place/`로 요청하면 알맞은 경로로 리다이렉트된다.
 */
export const NAVER_PLACE_HOME_URL = "https://m.place.naver.com/place/{placeId}/home";

/** 상세 페이지 HTML 안에 화면 데이터를 담아 두는 전역 변수 */
export const NAVER_PLACE_APOLLO_STATE_MARKER = "window.__APOLLO_STATE__";

/** 네이버 플레이스 ID를 꺼낼 수 있는 호스트 */
export const NAVER_PLACE_HOSTS = [
  "map.naver.com",
  "m.map.naver.com",
  "m.place.naver.com",
  "pcmap.place.naver.com",
  "place.naver.com",
];

/** 네이버 지도 공유 단축 링크 호스트 (리다이렉트를 따라가야 플레이스 ID가 나온다) */
export const NAVER_SHORT_URL_HOST = "naver.me";

/** 단축 링크 리다이렉트를 따라가는 최대 횟수 */
export const NAVER_SHORT_URL_MAX_REDIRECTS = 3;

/** 네이버 요청 타임아웃 (ms) */
export const NAVER_PLACE_REQUEST_TIMEOUT_MS = 10000;

/** 네이버 요청 User-Agent (모바일 브라우저로 열 때와 같은 HTML을 받기 위함) */
export const NAVER_PLACE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** 같은 플레이스 재조회를 막는 캐시 유지 시간 (ms) */
export const NAVER_PLACE_CACHE_TTL_MS = 10 * 60 * 1000;

/** 캐시에 보관하는 최대 플레이스 수 */
export const NAVER_PLACE_CACHE_MAX_SIZE = 200;

/** 응답에 담는 최대 사진 수 */
export const NAVER_PLACE_MAX_PHOTOS = 10;

/** 네이버 요일 표기 → Date.getDay() 값 (0=일 … 6=토) */
export const NAVER_DAY_TO_WEEKDAYS: Record<string, number[]> = {
  일: [0],
  월: [1],
  화: [2],
  수: [3],
  목: [4],
  금: [5],
  토: [6],
  매일: [0, 1, 2, 3, 4, 5, 6],
  평일: [1, 2, 3, 4, 5],
  주말: [0, 6],
};

/** Date.getDay() 값 → 요일 이름 */
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 네이버 플레이스 에러 메시지 */
export const NAVER_PLACE_ERROR_MESSAGES = {
  INVALID_URL:
    "네이버 플레이스 링크를 확인해 주세요. (예: https://naver.me/xxxx, https://map.naver.com/p/entry/place/123456)",
  NOT_FOUND: "네이버 플레이스에서 매장을 찾지 못했어요.",
  FETCH_FAILED:
    "네이버에서 매장 정보를 가져오지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.",
  PARSE_FAILED: "네이버 매장 정보 형식을 읽지 못했어요. 직접 입력해 주세요.",
};

/** 스토어 자동 채우기 경고 메시지 */
export const NAVER_PLACE_PREFILL_WARNINGS = {
  HOURS_MISSING: "네이버에 영업시간이 없어요. 영업시간을 직접 입력해 주세요.",
  HOURS_NOT_30_MIN: (time: string) =>
    `네이버 영업시간(${time})이 30분 단위가 아니라서 자동으로 채우지 않았어요.`,
  HOURS_OVERNIGHT: "자정을 넘기는 영업시간은 자동으로 채우지 않았어요.",
  HOURS_DIFFER_BY_DAY: (days: string) =>
    `영업시간이 다른 요일이 있어요: ${days}. 날짜별 예외로 따로 설정해 주세요.`,
  BREAK_HOURS: "네이버의 브레이크타임은 Picake에 저장되지 않아요.",
  UNKNOWN_DAYS: (days: string) => `${days}요일은 네이버에 영업 정보가 없어 휴무로 넣지 않았어요.`,
  VIRTUAL_PHONE: "네이버 안심번호(0507)예요. 실제 연락처로 바꾸는 걸 권장해요.",
};
