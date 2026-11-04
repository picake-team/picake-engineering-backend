import {
  NAVER_DAY_TO_WEEKDAYS,
  NAVER_PLACE_PREFILL_WARNINGS,
  WEEKDAY_LABELS,
} from "@apps/backend/modules/naver-place/constants/naver-place.constants";
import { STORE_BUSINESS_TIME_HHMM_REGEX } from "@apps/backend/modules/store/constants/store-business-calendar.constants";
import { NaverPlaceInfo } from "@apps/backend/modules/naver-place/utils/naver-place-parser.util";
import {
  IsValidStoreDescriptionConstraint,
  IsValidStoreNameConstraint,
  IsValidStorePhoneNumberConstraint,
} from "@apps/backend/modules/store/decorators/validators.decorator";

/**
 * 스토어 등록·수정 폼에 채울 수 있는 값 (값이 없으면 null)
 * 주소·좌표는 참고용이다. 실제 주소는 판매자가 기존 주소 검색으로 확정한다.
 * 영업시간은 여기에 넣지 않는다(픽업 가능 시간과 다를 수 있어 참고로만 보여 준다).
 */
export type NaverPlaceStorePrefill = {
  name: string;
  description: string | null;
  phoneNumber: string | null;
  instagramId: string | null;
  address: string | null;
  roadAddress: string | null;
  latitude: number | null;
  longitude: number | null;
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
 * 영업 캘린더 반영(I-10 3단계)에서 쓴다. 지금은 응답에 넣지 않는다.
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
 * 네이버 플레이스 정보를 스토어 폼에 채울 값으로 바꾼다.
 * Picake 입력 규칙에 맞지 않는 값은 자르거나 고치지 않고 그대로 두고 경고로 알린다.
 */
export function toStorePrefill(info: NaverPlaceInfo): {
  storePrefill: NaverPlaceStorePrefill;
  warnings: string[];
} {
  const warnings: string[] = [];

  const nameRule = new IsValidStoreNameConstraint();
  if (!nameRule.validate(info.name)) {
    warnings.push(NAVER_PLACE_PREFILL_WARNINGS.NAME_INVALID(nameRule.defaultMessage()));
  }
  const descriptionRule = new IsValidStoreDescriptionConstraint();
  if (info.description && !descriptionRule.validate(info.description)) {
    warnings.push(
      NAVER_PLACE_PREFILL_WARNINGS.DESCRIPTION_INVALID(descriptionRule.defaultMessage()),
    );
  }
  if (info.phone) {
    const phoneRule = new IsValidStorePhoneNumberConstraint();
    if (!phoneRule.validate(info.phone)) {
      warnings.push(NAVER_PLACE_PREFILL_WARNINGS.PHONE_INVALID(phoneRule.defaultMessage()));
    } else if (info.isVirtualPhone) {
      warnings.push(NAVER_PLACE_PREFILL_WARNINGS.VIRTUAL_PHONE);
    }
  }

  return {
    storePrefill: {
      name: info.name,
      description: info.description,
      phoneNumber: info.phone,
      instagramId: extractInstagramId(info.links.instagram),
      address: info.address,
      roadAddress: info.roadAddress,
      latitude: info.latitude,
      longitude: info.longitude,
    },
    warnings,
  };
}
