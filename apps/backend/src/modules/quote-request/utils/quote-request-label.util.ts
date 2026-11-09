import { QuoteCakeSize, QuoteCream } from "@apps/backend/infra/database/prisma/generated/client";
import {
  QUOTE_CAKE_SIZE_LABELS,
  QUOTE_CREAM_LABELS,
} from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import {
  kstDateHourToDate,
  toKstParts,
} from "@apps/backend/modules/quote-request/utils/quote-request-time.util";

/**
 * 견적 요청을 사람이 읽는 한 줄로 바꾼다(운영자 디스코드 알림·관리자 화면·알림톡 변수에 같이 쓴다).
 * 화면 문구는 기획 I-46 SC-14·17과 같다.
 */

/** 0~24시를 "오전 9시"·"오후 2시"·"밤 11시"처럼 */
export function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "밤 12시";
  if (h <= 5) return `새벽 ${h}시`;
  if (h <= 11) return `오전 ${h}시`;
  if (h === 12) return "낮 12시";
  if (h <= 20) return `오후 ${h - 12}시`;
  return `밤 ${h - 12}시`;
}

function periodOf(label: string): string {
  return label.split(" ")[0];
}

/** "오후 2시~5시", 오전·오후가 다르면 "오전 11시~오후 2시" */
export function formatHourRange(from: number, to: number): string {
  const a = formatHour(from);
  const b = formatHour(to);
  return periodOf(a) === periodOf(b) ? `${a}~${b.split(" ")[1]}` : `${a}~${b}`;
}

/** "12월 24일(목)" */
export function formatKstDate(date: Date): string {
  const p = toKstParts(date);
  return `${p.month}월 ${p.day}일(${p.weekday})`;
}

/** "12월 23일(수) 밤 11시" */
export function formatKstDateTime(date: Date): string {
  return `${formatKstDate(date)} ${formatHour(toKstParts(date).hour)}`;
}

/**
 * 픽업 줄: "12월 24일(목) 오후 2시~5시" / "12월 24일(목) 아무 때나" /
 * 오늘 "아무 때나"를 3시간 뒤로 본 경우 "11월 9일(일) 오후 7시 이후"
 */
export function formatPickup(input: {
  pickupDate: string;
  pickupHourFrom: number | null;
  pickupHourTo: number | null;
  pickupStartAt: Date;
}): string {
  const dayStart = kstDateHourToDate(input.pickupDate, 0);
  const date = formatKstDate(dayStart);
  if (input.pickupHourFrom !== null && input.pickupHourTo !== null) {
    return `${date} ${formatHourRange(input.pickupHourFrom, input.pickupHourTo)}`;
  }
  if (input.pickupStartAt.getTime() > dayStart.getTime()) {
    return `${date} ${formatHour(toKstParts(input.pickupStartAt).hour)} 이후`;
  }
  return `${date} 아무 때나`;
}

/** "1호 케이크 1개 · 생크림·크림치즈 · 초코 시트" */
export function formatCake(input: {
  size: QuoteCakeSize;
  quantity: number;
  creams: QuoteCream[];
  flavorNote: string | null;
}): string {
  const parts = [`${QUOTE_CAKE_SIZE_LABELS[input.size]} 케이크 ${input.quantity}개`];
  const flavors = [
    ...input.creams.map((c) => QUOTE_CREAM_LABELS[c]),
    input.flavorNote?.trim(),
  ].filter((v): v is string => Boolean(v));
  if (flavors.length > 0) parts.push(flavors.join("·"));
  return parts.join(" · ");
}

function toMan(won: number): string {
  const man = won / 10_000;
  return Number.isInteger(man) ? `${man}만` : `${man.toFixed(1)}만`;
}

/** "3만~5만원", "10만원 이상", "3만원"(같을 때). 2개 이상이면 "1개 3만~5만원" */
export function formatBudget(input: {
  budgetMin: number;
  budgetMax: number | null;
  quantity: number;
}): string {
  const { budgetMin, budgetMax, quantity } = input;
  let text: string;
  if (budgetMax === null) text = `${toMan(budgetMin)}원 이상`;
  else if (budgetMax === budgetMin) text = `${toMan(budgetMin)}원`;
  else text = `${toMan(budgetMin)}~${toMan(budgetMax)}원`;
  return quantity > 1 ? `1개 ${text}` : text;
}

/** "연남동 3km 안" / "연남동 · 서울 전체" / "이 가게에만" */
export function formatArea(input: {
  onlyDesignatedStores: boolean;
  areaName: string | null;
  areaSido: string | null;
  distanceKm: number | null;
}): string {
  if (input.onlyDesignatedStores || !input.areaName) return "이 가게에만";
  if (input.distanceKm !== null) return `${input.areaName} ${input.distanceKm}km 안`;
  return `${input.areaName} · ${input.areaSido ?? "시·도"} 전체`;
}
