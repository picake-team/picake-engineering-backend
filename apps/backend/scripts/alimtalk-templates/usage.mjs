#!/usr/bin/env node
/**
 * 지난 N일 동안 SOLAPI로 보낸 메시지를 읽기만 해서 템플릿·날짜·받는 사람별로 센다(알림톡이 너무 많이 가는지 확인).
 * 공개 레포 Actions 로그에 남으므로 휴대폰 번호·내용은 찍지 않는다. 받는 사람은 많이 받은 순서로 A, B, C…로만 쓴다.
 *
 * 실행: alimtalk-usage-* 태그 push(워크플로 alimtalk-templates.yml). 로컬: SOLAPI_API_KEY·SOLAPI_API_SECRET 넣고 node usage.mjs
 */
import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";

const API = "https://api.solapi.com";
const { SOLAPI_API_KEY, SOLAPI_API_SECRET, GITHUB_STEP_SUMMARY } = process.env;
const DAYS = Number(process.env.USAGE_DAYS || 7);

if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET) {
  console.error("SOLAPI_API_KEY·SOLAPI_API_SECRET가 없습니다.");
  process.exit(1);
}

function authorization() {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", SOLAPI_API_SECRET)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function get(path) {
  const res = await fetch(API + path, { headers: { Authorization: authorization() } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path.split("?")[0]}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function kstDay(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function kstHour(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).getUTCHours();
}

// 템플릿 이름(같은 채널의 템플릿 목록)
const names = new Map();
try {
  const t = await get("/kakao/v2/templates?limit=100");
  for (const x of t.templateList ?? []) names.set(x.templateId, x.name);
} catch (e) {
  console.log(`템플릿 이름을 못 읽음: ${e.message}`);
}

// 메시지 목록(페이지 넘기기)
const start = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString();
const messages = [];
let startKey = "";
for (let page = 0; page < 40; page++) {
  const q = new URLSearchParams({ limit: "500", startDate: start });
  if (startKey) q.set("startKey", startKey);
  const r = await get(`/messages/v4/list?${q}`);
  const list = r.messageList ?? {};
  const rows = Array.isArray(list) ? list : Object.values(list);
  messages.push(...rows);
  if (!r.nextKey || rows.length === 0) break;
  startKey = r.nextKey;
}

const label = (m) => {
  const id = m.kakaoOptions?.templateId ?? m.templateId ?? "";
  if (id) return names.get(id) ?? `(이름 모름) ${id.slice(-6)}`;
  return `문자 ${m.type ?? ""}`.trim();
};
const created = (m) => m.dateCreated ?? m.dateSent ?? m.createdAt;

// 받는 사람: 많이 받은 순서로 A, B, C…
const byTo = new Map();
for (const m of messages) byTo.set(m.to, (byTo.get(m.to) ?? 0) + 1);
const toLabel = new Map(
  [...byTo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([to], i) => [to, i < 26 ? String.fromCharCode(65 + i) : `#${i + 1}`]),
);

const out = [];
const p = (s = "") => out.push(s);
p(
  `## SOLAPI 발송 ${DAYS}일 (${kstDay(start)}~, 모두 ${messages.length}건, 받는 사람 ${byTo.size}명)`,
);

// 템플릿 × 날짜
const days = [...new Set(messages.map((m) => kstDay(created(m))))].sort();
const tpl = new Map();
for (const m of messages) {
  const k = label(m);
  const row = tpl.get(k) ?? {};
  const d = kstDay(created(m));
  row[d] = (row[d] ?? 0) + 1;
  tpl.set(k, row);
}
p("");
p(`| 템플릿 | 합 | ${days.map((d) => d.slice(5)).join(" | ")} |`);
p(`|---|---|${days.map(() => "---").join("|")}|`);
for (const [k, row] of [...tpl.entries()].sort(
  (a, b) =>
    Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0),
)) {
  const sum = Object.values(row).reduce((x, y) => x + y, 0);
  p(`| ${k} | ${sum} | ${days.map((d) => row[d] ?? 0).join(" | ")} |`);
}

// 받는 사람 × 템플릿(위 5명)
p("");
p("| 받는 사람 | 합 | 템플릿별 |");
p("|---|---|---|");
for (const [to, n] of [...byTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  const per = new Map();
  for (const m of messages.filter((x) => x.to === to))
    per.set(label(m), (per.get(label(m)) ?? 0) + 1);
  p(
    `| ${toLabel.get(to)} | ${n} | ${[...per.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")} |`,
  );
}

// 같은 사람에게 1시간 안에 2건 넘게 간 때(몰림)
p("");
p("| 받는 사람 | 한국 시각 | 1시간 안 건수 | 템플릿 |");
p("|---|---|---|---|");
let bursts = 0;
for (const to of byTo.keys()) {
  const ms = messages
    .filter((x) => x.to === to)
    .sort((a, b) => new Date(created(a)) - new Date(created(b)));
  for (let i = 0; i < ms.length; i++) {
    const t0 = new Date(created(ms[i])).getTime();
    const win = ms.filter((x) => {
      const t = new Date(created(x)).getTime();
      return t >= t0 && t < t0 + 3600 * 1000;
    });
    if (win.length >= 3) {
      bursts++;
      if (bursts <= 15) {
        const d = created(ms[i]);
        p(
          `| ${toLabel.get(to)} | ${kstDay(d).slice(5)} ${kstHour(d)}시 | ${win.length} | ${win.map(label).join(", ")} |`,
        );
      }
      i += win.length - 1;
    }
  }
}
if (bursts === 0) p("| - | - | 없음 | - |");

// 결과 코드
const codes = new Map();
for (const m of messages)
  codes.set(
    String(m.statusCode ?? m.status ?? "?"),
    (codes.get(String(m.statusCode ?? m.status ?? "?")) ?? 0) + 1,
  );
p("");
p(`결과 코드: ${[...codes.entries()].map(([k, v]) => `${k}=${v}`).join(", ")} (4000이 성공)`);

const text = out.join("\n");
console.log(text);
if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, text + "\n");
