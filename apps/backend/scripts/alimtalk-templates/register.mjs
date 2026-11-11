// 카카오 알림톡 템플릿을 SOLAPI에 등록하고 카카오 검수를 요청한다(.github/workflows/alimtalk-templates.yml에서 실행).
//
// - 기존 템플릿 목록을 먼저 보여 주고, templates.json의 템플릿과 형식(카테고리·강조 표기·버튼)이 맞는지 확인한다.
// - APPLY=true일 때만 SOLAPI를 바꾼다: 이름이 같은 템플릿이 없으면 만들고, 검수 전(PENDING)이면 검수를 요청한다.
//   이미 검수 중·승인·반려인 템플릿은 건드리지 않는다(반려면 문구를 고쳐 SOLAPI 콘솔이나 수정 API로 다시 낸다).
// - 키는 SOLAPI_API_KEY·SOLAPI_API_SECRET 환경변수에서만 읽고 출력하지 않는다. 템플릿 문구는 손님에게 가는 공개 문구라 로그에 남겨도 된다.
/* global process, console, fetch, URLSearchParams */
import { readFileSync, appendFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.solapi.com";
const { SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_PFID, APPLY, GITHUB_STEP_SUMMARY } = process.env;
const apply = APPLY === "true";

if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_PFID) {
  console.error("SOLAPI_API_KEY·SOLAPI_API_SECRET·SOLAPI_PFID가 필요합니다.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "templates.json"), "utf8"));

function authorization() {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", SOLAPI_API_SECRET)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: authorization(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → HTTP ${res.status} ${json.errorCode ?? ""} ${json.errorMessage ?? json.raw ?? ""}`,
    );
  }
  return json;
}

async function listTemplates() {
  const all = [];
  let startKey;
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "100", ...(startKey ? { startKey } : {}) });
    const res = await call("GET", `/kakao/v2/templates?${query}`);
    all.push(...(res.templateList ?? []));
    if (!res.nextKey || res.nextKey === startKey) break;
    startKey = res.nextKey;
  }
  return all;
}

const summary = [];
const log = (line = "") => {
  console.log(line);
  summary.push(line);
};

function checkTemplate(t) {
  const problems = [];
  const vars = t.content.match(/#\{[^}]+\}/g) ?? [];
  if (t.content.length > 1000) problems.push("본문이 1000자를 넘음");
  if (/\*\*/.test(t.content)) problems.push("본문에 마크다운 굵게 표시가 있음");
  for (const b of t.buttons ?? []) {
    if (b.buttonName.length > 14) problems.push(`버튼 이름 14자 초과: ${b.buttonName}`);
    if (b.buttonType === "WL" && !/^https:\/\//.test(b.linkMo))
      problems.push(`버튼 링크가 https://로 시작하지 않음: ${b.linkMo}`);
  }
  return { vars, problems };
}

const existing = await listTemplates();
const categories = await call("GET", "/kakao/v2/templates/categories").catch(() => []);
const categoryName = (code) => {
  const c = (Array.isArray(categories) ? categories : []).find((x) => x.code === code);
  return c ? `${code} ${c.name}` : code;
};
log(`## 알림톡 템플릿 (${apply ? "등록·검수 요청" : "확인만"})`);
log("");
log("### SOLAPI에 있는 템플릿");
log("| 상태 | 카테고리 | 강조 제목 | 이름 | 같은 채널 |");
log("|---|---|---|---|---|");
for (const t of existing) {
  log(
    `| ${t.status} | ${t.categoryCode} | ${t.emphasizeTitle ?? "-"} | ${t.name} | ${t.channelId === SOLAPI_PFID ? "예" : "아니오"} |`,
  );
}
log("");

// 기존 템플릿 본문·버튼(손님에게 가는 공개 문구). 새 판을 만들 때 원문을 그대로 옮겨 고치려고 보여 준다
log("### 기존 템플릿 본문");
for (const t of existing.filter((e) => e.channelId === SOLAPI_PFID)) {
  log(`<details><summary>${t.templateId} ${t.name} (${t.status})</summary>`);
  log("");
  log("```");
  log(t.content ?? "");
  log("```");
  log(`버튼: ${(t.buttons ?? []).map((b) => `[${b.buttonName}] ${b.buttonType} ${b.linkMo ?? ""}`).join(", ") || "없음"}`);
  log(`강조: ${t.emphasizeType ?? "-"} / ${t.emphasizeTitle ?? "-"} / ${t.emphasizeSubtitle ?? "-"}, 메시지 유형: ${t.messageType ?? "-"}`);
  log("</details>");
  log("");
}

let failed = false;
for (const t of config.templates) {
  const { vars, problems } = checkTemplate(t);
  const found = existing.find((e) => e.name === t.name && e.channelId === SOLAPI_PFID);
  log(`### ${t.key} — ${t.emphasizeTitle}`);
  log(`- 이름: ${t.name}`);
  log(`- 카테고리: ${categoryName(t.categoryCode)}`);
  log(`- 변수: ${[...new Set(vars)].join(" ")}`);
  log(`- 버튼: ${(t.buttons ?? []).map((b) => `[${b.buttonName}] ${b.linkMo}`).join(", ")}`);
  if (problems.length) {
    log(`- 문제: ${problems.join(" / ")}`);
    failed = true;
    continue;
  }

  let current = found;
  if (!current && apply) {
    const body = Object.fromEntries(Object.entries(t).filter(([k]) => k !== "key"));
    current = await call("POST", "/kakao/v2/templates", { channelId: SOLAPI_PFID, ...body });
    log(`- 새로 만듦: ${current.templateId} (${current.status})`);
  } else if (current) {
    log(`- 이미 있음: ${current.templateId} (${current.status})`);
  } else {
    log("- 아직 없음(APPLY=true로 돌리면 만듦)");
  }

  if (current && apply && current.status === "PENDING") {
    const inspected = await call("PUT", `/kakao/v2/templates/${current.templateId}/inspection`, {
      comment: config.inspectionComment,
    });
    log(`- 검수 요청: ${inspected.templateId} → ${inspected.status}`);
  }
  log("");
}

if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
if (failed) process.exit(1);
