import "reflect-metadata";

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { getMetadataStorage } from "class-validator";
import { describe, expect, it } from "vitest";

/**
 * 서버가 받는 글자 칸(@IsString)마다 길이 한도가 있는지(검토 자동 검사, 11-18).
 * 한도가 없으면 아주 긴 글이 DB·알림톡·AI 요청까지 그대로 간다(11-17 알림톡 취소 사유가 카카오 한도를 넘어
 * 손님 안내가 안 갔고, 주문 요청사항·수량에 한도가 없었다). 검토 때마다 손으로 찾던 것을 테스트로 둔다.
 *
 * 지금 한도가 없는 칸은 아래 기준 목록(dto-string-length.baseline.json)에 적어 두고 통과시킨다 — 새로 생기는
 * 칸만 막는다. 한도를 넣어 목록에서 빠지게 되면 목록에서도 지운다(지우라고 실패한다).
 *
 * 한도로 보는 것: MaxLength·Length, 고르는 값(IsEnum·IsIn), 모양(Matches·날짜·UUID), 직접 만든 검사(전화번호 등).
 */

const BOUNDED = new Set([
  "maxLength",
  "isLength",
  "isEnum",
  "isIn",
  "matches",
  "isDateString",
  "isYmdDateString",
  "isISO8601",
  "isUuid",
  "isMobilePhone",
  "isNumberString",
  "customValidation",
]);

const SRC = join(__dirname, "../..");

/** src 아래 *.dto.ts 파일(생성된 Prisma 코드 제외). import.meta.glob은 배포 빌드(nest build)가 받지 않아 직접 찾는다 */
function dtoFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory())
      return e.name === "generated" || e.name === "node_modules" ? [] : dtoFiles(full);
    return e.name.endsWith(".dto.ts") ? [full] : [];
  });
}

async function unboundedStringFields(): Promise<string[]> {
  const storage = getMetadataStorage();
  const out = new Set<string>();
  for (const file of dtoFiles()) {
    const mod = (await import(file)) as Record<string, unknown>;
    for (const [exportName, value] of Object.entries(mod)) {
      if (typeof value !== "function") continue;
      const metas = storage.getTargetValidationMetadatas(value as never, "", true, false);
      const byProp = storage.groupByPropertyName(metas);
      for (const [prop, list] of Object.entries(byProp)) {
        const names = list.map((m) => String(m.name ?? m.type));
        if (!names.includes("isString")) continue;
        if (names.some((n) => BOUNDED.has(n))) continue;
        out.add(`${relative(SRC, file)} ${exportName}.${prop}`);
      }
    }
  }
  return [...out].sort();
}

describe("서버 입력 글자 칸 길이 한도", () => {
  it("한도 없는 글자 칸이 새로 생기지 않는다", async () => {
    const baseline: string[] = JSON.parse(
      readFileSync(join(__dirname, "dto-string-length.baseline.json"), "utf8"),
    );
    const now = await unboundedStringFields();
    expect(now.length).toBeGreaterThan(0); // DTO를 못 읽으면 빈 채로 통과하지 않게

    const added = now.filter((x) => !baseline.includes(x));
    const fixed = baseline.filter((x) => !now.includes(x));
    // 새 칸이면: @MaxLength(n)을 붙인다(화면 한도와 같게). 정말 한도가 필요 없으면 기준 목록에 이유와 함께 더한다.
    expect(added, "한도 없는 새 글자 칸 — @MaxLength를 붙이세요").toEqual([]);
    // 한도를 넣었으면 기준 목록에서도 지운다
    expect(fixed, "한도가 생긴 칸 — dto-string-length.baseline.json에서 지우세요").toEqual([]);
  });
});
