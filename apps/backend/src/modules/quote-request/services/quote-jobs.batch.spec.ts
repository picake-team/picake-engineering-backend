import { describe, expect, it } from "vitest";
import { BATCH, eachBatch } from "./quote-jobs.service";

const rows = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(from + i).padStart(5, "0") }));

describe("eachBatch(견적 시간 일 100건씩 끝까지)", () => {
  it("100개를 넘어도 끝까지 돌고, 다음 묶음은 앞 묶음 마지막 번호 뒤부터 읽는다", async () => {
    const pages = [rows(0, BATCH), rows(BATCH, BATCH), rows(BATCH * 2, 3)];
    const asked: (string | undefined)[] = [];
    const seen: string[] = [];
    await eachBatch(
      async (afterId) => {
        asked.push(afterId);
        return pages.shift() ?? [];
      },
      async (r) => {
        seen.push(r.id);
      },
    );
    expect(seen).toHaveLength(BATCH * 2 + 3);
    expect(asked).toEqual([undefined, rows(BATCH - 1, 1)[0].id, rows(BATCH * 2 - 1, 1)[0].id]);
  });

  it("딱 100개면 한 번 더 읽어 빈 묶음에서 멈춘다", async () => {
    const pages = [rows(0, BATCH), []];
    let calls = 0;
    await eachBatch(
      async () => {
        calls += 1;
        return pages.shift() ?? [];
      },
      async () => {},
    );
    expect(calls).toBe(2);
  });
});
