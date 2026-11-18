import { ACT_AS_LIMITS } from "@apps/backend/modules/act-as/constants/act-as.constants";

/** 기록 한 줄에 필요한 요청 모양(Express Request의 일부) */
export interface ActAsAuditRequest {
  method: string;
  originalUrl?: string;
  route?: { path?: string };
  params?: Record<string, unknown>;
  body?: unknown;
}

export interface ActAsActionRecord {
  method: string;
  route: string;
  targetId: string | null;
  fields: string[];
}

/** 경로 틀에서 전역 접두사(`/v1`)를 뺀다: "/v1/seller/products/:id" → "/seller/products/:id" */
export function actAsRouteTemplate(req: ActAsAuditRequest): string {
  const raw =
    typeof req.route?.path === "string"
      ? req.route.path
      : // 경로 틀을 모르면 주소에서 쿼리만 뺀다(값이 든 쿼리는 남기지 않음)
        (req.originalUrl ?? "").split("?")[0];
  return raw.replace(/^\/v\d+(?=\/)/, "").slice(0, 160) || "/";
}

/** 무엇을 건드렸나: 가장 좁은 id부터(상품·주문 id → 스토어 id) */
const TARGET_PARAM_ORDER = ["id", "productId", "orderId", "itemKey", "storeId"] as const;

export function actAsTargetId(
  params: Record<string, unknown> | undefined,
  responseData?: unknown,
): string | null {
  // 새로 만든 것(상품·직접 적은 주문 등록)은 응답의 id를 먼저 — 주소의 storeId보다 좁다
  if (responseData && typeof responseData === "object" && "id" in responseData) {
    const id = (responseData as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id.slice(0, 64);
  }
  for (const key of TARGET_PARAM_ORDER) {
    const v = params?.[key];
    // 경로 값도 %00 같은 글자가 섞이면 기록이 빠지므로 id에 쓰는 글자만 남긴다
    if (typeof v === "string" && v.length > 0)
      return v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || null;
  }
  return null;
}

/** 보낸 칸 이름만(값은 남기지 않는다 — 캡처·손님 이름·계좌가 들어 있다) */
export function actAsFieldNames(method: string, body: unknown): string[] {
  if (method === "GET" || method === "DELETE") return [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  // 칸 이름은 보낸 사람이 정한다 — NUL·짝 없는 이모지 반쪽은 Postgres·Prisma가 거절해 기록이 통째로 빠졌다(11-18 검토).
  // 영문·숫자·_.-[]만 남기고(나머지는 ?), 남은 글자는 모두 한 칸짜리라 잘라도 깨지지 않는다
  return Object.keys(body)
    .slice(0, ACT_AS_LIMITS.FIELDS_MAX)
    .map((k) => k.replace(/[^A-Za-z0-9_.\-[\]]/g, "?").slice(0, ACT_AS_LIMITS.FIELD_NAME_MAX));
}

export function buildActAsActionRecord(
  req: ActAsAuditRequest,
  responseData?: unknown,
): ActAsActionRecord {
  const method = (req.method ?? "GET").toUpperCase().slice(0, 8);
  return {
    method,
    route: actAsRouteTemplate(req),
    targetId: actAsTargetId(req.params, method === "POST" ? responseData : undefined),
    fields: actAsFieldNames(method, req.body),
  };
}

/** 기록 묶음(관리자 화면 한 줄 요약): 무엇을 몇 번 했나 */
export type ActAsActionArea = "product" | "manualOrder" | "calendar" | "store" | "view" | "blocked";

export function actAsActionArea(action: {
  method: string;
  route: string;
  status: number;
}): ActAsActionArea {
  if (action.status === 403) return "blocked";
  // Express는 GET 길로 HEAD도 받는다 — 보기로 센다(쓰기로 잡혔음)
  if (action.method === "GET" || action.method === "HEAD") return "view";
  const r = action.route;
  // 캡처 읽기는 AI가 읽기만 하고 저장하지 않는다
  if (r.endsWith("/manual-orders/read")) return "view";
  if (r.includes("/manual-orders")) return "manualOrder";
  if (r.includes("/business-calendar")) return "calendar";
  if (
    r.startsWith("/seller/products") ||
    r.includes("/naver-products") ||
    r.includes("/description-draft") ||
    r.startsWith("/seller/uploads")
  ) {
    return "product";
  }
  if (r.startsWith("/seller/store")) return "store";
  return "view";
}

export interface ActAsActionSummary {
  product: number;
  manualOrder: number;
  calendar: number;
  store: number;
  view: number;
  blocked: number;
}

/** 성공한 쓰기만 센다(실패한 쓰기는 기록에는 남지만 요약에서 뺀다). 막힌 요청은 따로 */
export function summarizeActAsActions(
  actions: Array<{ method: string; route: string; status: number }>,
): ActAsActionSummary {
  const summary: ActAsActionSummary = {
    product: 0,
    manualOrder: 0,
    calendar: 0,
    store: 0,
    view: 0,
    blocked: 0,
  };
  for (const a of actions) {
    // 들어오기·끝내기·띠 정보는 운영자가 한 일이 아니다
    if (a.route.startsWith("/seller/act-as")) continue;
    const area = actAsActionArea(a);
    if (area === "blocked" || area === "view") {
      summary[area] += 1;
      continue;
    }
    if (a.status >= 200 && a.status < 300) summary[area] += 1;
  }
  return summary;
}
