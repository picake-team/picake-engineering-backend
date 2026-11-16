import { ValidateBy } from "class-validator";
import type { ValidationOptions } from "class-validator";
import {
  YMD_DATE_STRING_DEFAULT_MESSAGE,
  YMD_DATE_STRING_PATTERN,
} from "@apps/backend/common/constants/date-query.constant";

/**
 * YYYY-MM-DD 달력 날짜 문자열 검증 (`Matches` + 공통 패턴·메시지)
 *
 * 필요 시 필드별 문구는 `@IsYmdDateString({ message: '...' })` 로 지정합니다.
 * (`validators.decorator.ts`의 `IsValidUserId` 등과 동일하게 공통 검증을 한곳에 둡니다.)
 */
/** 모양(YYYY-MM-DD)뿐 아니라 실제 있는 날짜인지 — "2026-13-45"는 모양만 맞아 Invalid Date로 500이 났다(11-16 검토) */
export function isRealYmdDateString(value: unknown): boolean {
  if (typeof value !== "string" || !YMD_DATE_STRING_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function IsYmdDateString(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: "isYmdDateString",
      validator: {
        validate: (value: unknown) => isRealYmdDateString(value),
        defaultMessage: () => YMD_DATE_STRING_DEFAULT_MESSAGE,
      },
    },
    validationOptions,
  );
}
