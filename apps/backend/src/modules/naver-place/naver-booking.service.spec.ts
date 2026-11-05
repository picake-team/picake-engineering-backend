import { describe, expect, it, vi } from "vitest";
import { NaverBookingService } from "@apps/backend/modules/naver-place/naver-booking.service";

// 네이버를 부르지 않고, 요청 종류(operationName)마다 정해 둔 응답을 돌려준다
function serviceWith(responses: Record<string, unknown | Error>) {
  const service = new NaverBookingService();
  const calls: string[] = [];
  (service as any).axiosInstance = {
    post: vi.fn(async (_url: string, body: { operationName: string }) => {
      calls.push(body.operationName);
      const r = responses[body.operationName];
      if (r instanceof Error || r === undefined) throw r ?? new Error("no mock");
      return { data: r };
    }),
  };
  return { service, calls };
}

const option = { optionId: "1", name: "샘플 케이크 1호", price: 40000 };
const OPTION_OK = { data: { option: [{ name: "카테고리 미지정", options: [option] }] } };
const HOURLY_OK = {
  data: {
    hourlySchedule: [
      { slotId: "1", scheduleId: "2", unitStartDateTime: "2026-11-06T11:00:00+09:00" },
    ],
  },
};
const DAILY_OK = {
  data: { timeSlotAvailabilityDailySummaries: [{ date: "2026-11-08", hasSlots: true }] },
};

describe("NaverBookingService.getItemOptions", () => {
  it("픽업(업종 6)은 시간 단위로 먼저 읽는다", async () => {
    const { service, calls } = serviceWith({ HourlySchedule: HOURLY_OK, Option: OPTION_OK });
    const r = await service.getItemOptions("100", "200", 6);
    expect(r.status).toBe("OK");
    expect(r.options?.[0].name).toBe("샘플 케이크 1호");
    expect(calls).toEqual(["HourlySchedule", "Option"]);
  });

  it("다른 업종은 날짜 단위로 먼저 읽는다", async () => {
    const { service, calls } = serviceWith({
      TimeSlotAvailabilityDailySummaries: DAILY_OK,
      Option: OPTION_OK,
    });
    const r = await service.getItemOptions("100", "201", 17);
    expect(r.status).toBe("OK");
    expect(calls).toEqual(["TimeSlotAvailabilityDailySummaries", "Option"]);
  });

  it("시간 단위가 안 되면 날짜 단위로 다시 시도한다", async () => {
    const { service, calls } = serviceWith({
      HourlySchedule: new Error("Invalid request"),
      TimeSlotAvailabilityDailySummaries: DAILY_OK,
      Option: OPTION_OK,
    });
    const r = await service.getItemOptions("100", "202", 6);
    expect(r.status).toBe("OK");
    expect(calls).toEqual(["HourlySchedule", "TimeSlotAvailabilityDailySummaries", "Option"]);
  });

  it("예약 가능한 날이 없으면 NO_SCHEDULE", async () => {
    const { service } = serviceWith({
      HourlySchedule: { data: { hourlySchedule: [] } },
      TimeSlotAvailabilityDailySummaries: { data: { timeSlotAvailabilityDailySummaries: [] } },
    });
    const r = await service.getItemOptions("100", "203", 6);
    expect(r).toEqual({ options: null, status: "NO_SCHEDULE" });
  });

  it("일정은 있는데 옵션 요청을 받지 않으면(프랜차이즈 주문 등) FAILED, 예외는 던지지 않는다", async () => {
    const { service } = serviceWith({
      HourlySchedule: HOURLY_OK,
      TimeSlotAvailabilityDailySummaries: new Error("Invalid request"),
      Option: { errors: [{ message: "Invalid request" }] },
    });
    const r = await service.getItemOptions("100", "204", 6);
    expect(r).toEqual({ options: null, status: "FAILED" });
  });

  it("숫자가 아닌 ID는 요청하지 않는다", async () => {
    const { service, calls } = serviceWith({});
    await expect(service.getItemOptions("../x", "1", 6)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
