import {
  NAVER_DAY_TO_WEEKDAYS,
  NAVER_PLACE_PREFILL_WARNINGS,
  WEEKDAY_LABELS,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";
import { STORE_BUSINESS_TIME_HHMM_REGEX } from "@apps/backend/modules/store/constants/store-business-calendar.constants";
import { NaverPlaceInfo } from "@apps/backend/modules/naver-place/utils/naver-place-parser.util";

/** 스토어 생성·수정 폼에 미리 채울 값 (값이 없으면 null) */
export type NaverPlaceStorePrefill = {
  name: string;
  description: string | null;
  phoneNumber: string | null;
  address: string | null;
  roadAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  instagramId: string | null;
  /** 정기 휴무 요일 (0=일 … 6=토). 영업시간 정보가 없으면 null */
  weeklyClosedWeekdays: number[] | null;
  /** 표준 영업 시작 HH:mm (30분 단위) */
  standardOpenTime: string | null;
  /** 표준 영업 종료 HH:mm (30분 단위) */
  standardCloseTime: string | null;
};

/**
 * 인스타그램 URL에서 계정 ID를 꺼낸다. (예: http://instagram.com/anemonesi → anemonesi)
 */
export function extractInstagramId(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return id && /^[A-Za-z0-9._]+$/.test(id) && !["p", "reel", "stories"].includes(id) ? id : null;
  } catch {
    return null;
  }
}

/** 네이버 종료 시각 "24:00"은 Picake에서 자정(00:00)으로 표현한다 */
const toPicakeTime = (hhmm: string) => (hhmm === "24:00" ? "00:00" : hhmm);

/**
 * 네이버 요일별 영업시간을 Picake 표준 영업시간(시작·종료 1개)과 정기 휴무 요일로 바꾼다.
 * - 가장 많은 요일이 쓰는 시간대를 표준으로 잡는다.
 * - 표준과 다른 요일, 30분 단위가 아닌 시간, 자정 넘김, 브레이크타임은 경고로 알린다.
 */
export function mapNaverBusinessHours(info: NaverPlaceInfo): {
  weeklyClosedWeekdays: number[] | null;
  standardOpenTime: string | null;
  standardCloseTime: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const windowByWeekday = new Map<number, string>(); // weekday → "open-close"
  const closedWeekdays = new Set<number>();
  let hasBreak = false;
  let hasOvernight = false;

  for (const day of info.businessHours.days) {
    const weekdays = NAVER_DAY_TO_WEEKDAYS[day.day];
    if (!weekdays) continue;
    if (!day.open || !day.close) {
      weekdays.forEach((w) => closedWeekdays.add(w));
      continue;
    }
    if (day.breakHours.length) hasBreak = true;
    if (day.endsNextDay || (day.close < day.open && day.close !== "00:00")) {
      hasOvernight = true;
      continue;
    }
    weekdays.forEach((w) => {
      windowByWeekday.set(
        w,
        `${toPicakeTime(day.open as string)}-${toPicakeTime(day.close as string)}`,
      );
      closedWeekdays.delete(w);
    });
  }

  if (!windowByWeekday.size && !closedWeekdays.size) {
    warnings.push(NAVER_PLACE_PREFILL_WARNINGS.HOURS_MISSING);
    return {
      weeklyClosedWeekdays: null,
      standardOpenTime: null,
      standardCloseTime: null,
      warnings,
    };
  }
  if (hasOvernight) warnings.push(NAVER_PLACE_PREFILL_WARNINGS.HOURS_OVERNIGHT);
  if (hasBreak) warnings.push(NAVER_PLACE_PREFILL_WARNINGS.BREAK_HOURS);

  const unknownDays = WEEKDAY_LABELS.filter(
    (_, w) => !windowByWeekday.has(w) && !closedWeekdays.has(w),
  );
  if (unknownDays.length && !hasOvernight) {
    warnings.push(NAVER_PLACE_PREFILL_WARNINGS.UNKNOWN_DAYS(unknownDays.join(", ")));
  }

  // 가장 많이 쓰인 시간대 (동률이면 먼저 나온 요일 기준)
  const counts = new Map<string, number>();
  windowByWeekday.forEach((window) => counts.set(window, (counts.get(window) ?? 0) + 1));
  const standard = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let standardOpenTime: string | null = null;
  let standardCloseTime: string | null = null;
  if (standard) {
    const [open, close] = standard.split("-");
    const invalid = [open, close].filter((t) => !STORE_BUSINESS_TIME_HHMM_REGEX.test(t));
    if (invalid.length) {
      warnings.push(NAVER_PLACE_PREFILL_WARNINGS.HOURS_NOT_30_MIN(invalid.join(", ")));
    } else {
      standardOpenTime = open;
      standardCloseTime = close;
    }

    const differentDays = [...windowByWeekday.entries()]
      .filter(([, window]) => window !== standard)
      .map(([w, window]) => `${WEEKDAY_LABELS[w]}요일 ${window.replace("-", "~")}`);
    if (differentDays.length) {
      warnings.push(NAVER_PLACE_PREFILL_WARNINGS.HOURS_DIFFER_BY_DAY(differentDays.join(", ")));
    }
  }

  return {
    weeklyClosedWeekdays: [...closedWeekdays].sort((a, b) => a - b),
    standardOpenTime,
    standardCloseTime,
    warnings,
  };
}

/**
 * 네이버 플레이스 정보를 스토어 폼 자동 채우기 값으로 바꾼다.
 */
export function toStorePrefill(info: NaverPlaceInfo): {
  storePrefill: NaverPlaceStorePrefill;
  warnings: string[];
} {
  const hours = mapNaverBusinessHours(info);
  const warnings = [...hours.warnings];
  if (info.phone && info.isVirtualPhone) warnings.push(NAVER_PLACE_PREFILL_WARNINGS.VIRTUAL_PHONE);

  return {
    storePrefill: {
      name: info.name,
      description: info.description,
      phoneNumber: info.phone,
      address: info.address,
      roadAddress: info.roadAddress,
      latitude: info.latitude,
      longitude: info.longitude,
      instagramId: extractInstagramId(info.links.instagram),
      weeklyClosedWeekdays: hours.weeklyClosedWeekdays,
      standardOpenTime: hours.standardOpenTime,
      standardCloseTime: hours.standardCloseTime,
    },
    warnings,
  };
}
