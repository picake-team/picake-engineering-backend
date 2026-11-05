/**
 * 네이버 플레이스 메뉴의 가격 표시("38,000원", "38000")를 숫자로 바꾼다.
 * 범위("38,000~54,000원")·"변동"처럼 하나로 정할 수 없으면 null.
 */
export function parseMenuPrice(text: string | null): number | null {
  if (!text) return null;
  const numbers = text.match(/\d[\d,]*/g) ?? [];
  if (numbers.length !== 1) return null;
  const value = Number(numbers[0].replace(/,/g, ""));
  return Number.isInteger(value) && value > 0 && value <= 100_000_000 ? value : null;
}
