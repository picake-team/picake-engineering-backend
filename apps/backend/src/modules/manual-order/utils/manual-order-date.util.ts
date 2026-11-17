/** YYYY-MM-DD 두 날의 날 수 차이(end - start). 같은 날이면 0 */
export function ymdDayDiff(start: string, end: string): number {
  const toUtc = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000);
}

/** YYYY-MM-DD에 날을 더한다 */
export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 그 날의 요일(0=일 … 6=토) */
export function ymdWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 한국 시간 날짜+시각(HH:mm)을 UTC Date로 */
export function kstDateTimeToUtc(ymd: string, hhmm: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm));
}
