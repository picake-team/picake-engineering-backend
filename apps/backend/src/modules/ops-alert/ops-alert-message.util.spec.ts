import { describe, expect, it } from "vitest";
import {
  buildNewSellerMessage,
  buildNewStoreEntryRequestMessage,
  buildNewStoreMessage,
  regionOf,
} from "@apps/backend/modules/ops-alert/ops-alert-message.util";

const ctx = { adminDomain: "https://admin.picakes.com/", environmentLabel: null };
const at = new Date("2026-11-11T03:00:00.000Z");

describe("운영자 실시간 알림 문구 (I-56)", () => {
  it("주소는 시·구까지만", () => {
    expect(regionOf("서울 마포구 와우산로 1")).toBe("서울 마포구");
    expect(regionOf(null)).toBe("-");
  });

  it("새 사장님 가입: 이름·연락처 없이 가입 방법과 관리자 링크", () => {
    const m = buildNewSellerMessage({ id: "s1", method: "KAKAO", createdAt: at }, ctx);
    const e = m.embeds[0];
    expect(e.title).toBe("새 사장님 가입");
    expect(e.url).toBe("https://admin.picakes.com/seller/members");
    expect(e.fields).toEqual([{ name: "가입 방법", value: "카카오", inline: true }]);
    expect(JSON.stringify(m)).not.toMatch(/010|phone/);
  });

  it("새 스토어 등록: 가게 이름의 디스코드 서식 기호를 뺀다", () => {
    const m = buildNewStoreMessage(
      {
        id: "st1",
        name: "**달콤** [케이크](x)",
        roadAddress: "서울 마포구 와우산로 1",
        createdAt: at,
      },
      { ...ctx, environmentLabel: "staging" },
    );
    const e = m.embeds[0];
    expect(e.title).toBe("[staging] 새 스토어 등록");
    expect(e.fields[0].value).toBe("달콤 케이크x");
    expect(e.fields[1].value).toBe("서울 마포구");
  });

  it("입점 요청: 업종 끝 단계와 이 가게 요청 수", () => {
    const m = buildNewStoreEntryRequestMessage(
      {
        placeName: "구름케이크",
        address: "서울 마포구 서교동 1",
        categoryName: "음식 > 간식 > 제과,베이커리",
        requestCount: 3,
        createdAt: at,
      },
      { adminDomain: null },
    );
    const e = m.embeds[0];
    expect(e.url).toBeUndefined();
    expect(e.fields.map((f) => f.value)).toEqual([
      "구름케이크",
      "서울 마포구",
      "제과,베이커리",
      "3명",
    ]);
  });
});
