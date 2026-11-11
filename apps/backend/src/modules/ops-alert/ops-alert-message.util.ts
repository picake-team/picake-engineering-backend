/**
 * 운영자 실시간 알림 문구(기획 I-56, 디스코드 【PICAKE】운영).
 * 지금 단계(첫 실제 가게 확보)에서 운영자가 바로 손을 써야 하는 일만 보낸다. 사람 이름·연락처는 넣지 않고 관리자 화면 링크로 연다.
 */

/** 디스코드 embed 한 칸 최대 1,024자 */
const FIELD_MAX = 1024;

/** 사용자가 적은 이름(가게·장소)은 디스코드 서식(링크·굵게·멘션)이 되지 않게 기호를 뺀다 */
export function plainText(text: string | null | undefined): string {
  return (text ?? "").replace(/[`*_~|[\]()<>#@\\]/g, "").trim();
}

function clip(text: string, max = FIELD_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 주소에서 "서울 마포구"처럼 시·구까지만 */
export function regionOf(address: string | null | undefined): string {
  const parts = plainText(address).split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "-";
}

export interface OpsAlertContext {
  adminDomain?: string | null;
  /** production이 아니면 "[staging]"처럼 제목 앞에 붙는다 */
  environmentLabel?: string | null;
}

function adminUrl(ctx: OpsAlertContext, path: string): string | undefined {
  return ctx.adminDomain ? `${ctx.adminDomain.replace(/\/$/, "")}${path}` : undefined;
}

function embed(
  ctx: OpsAlertContext,
  input: {
    title: string;
    hint: string;
    path: string;
    fields: { name: string; value: string; inline?: boolean }[];
    footer: string;
    at: Date;
  },
) {
  const env = ctx.environmentLabel ? `[${ctx.environmentLabel}] ` : "";
  const url = adminUrl(ctx, input.path);
  return {
    embeds: [
      {
        title: `${env}${input.title}`,
        description: url ? `[관리자에서 열기](${url}) · ${input.hint}` : input.hint,
        url,
        color: 0xff653e,
        fields: input.fields.map((f) => ({ inline: true, ...f, value: clip(f.value || "-") })),
        footer: { text: input.footer },
        timestamp: input.at.toISOString(),
      },
    ],
  };
}

export const SIGNUP_METHOD_LABELS = { KAKAO: "카카오", GOOGLE: "구글", APPLE: "애플" } as const;
export type SignupMethod = keyof typeof SIGNUP_METHOD_LABELS;

export interface NewSellerAlert {
  id: string;
  method: SignupMethod;
  createdAt: Date;
}

export interface NewStoreAlert {
  id: string;
  name: string;
  roadAddress?: string | null;
  address?: string | null;
  createdAt: Date;
}

export interface NewStoreEntryRequestAlert {
  placeName: string;
  roadAddress?: string | null;
  address?: string | null;
  categoryName?: string | null;
  requestCount: number;
  createdAt: Date;
}

/** 새 사장님 가입 — 스토어 등록 전에 막히지 않게 바로 돕는다 */
export function buildNewSellerMessage(seller: NewSellerAlert, ctx: OpsAlertContext) {
  return embed(ctx, {
    title: "새 사장님 가입",
    hint: "스토어 등록과 처음 상품 등록(대신 해 드림)을 도와 드려요.",
    path: "/seller/members",
    fields: [{ name: "가입 방법", value: SIGNUP_METHOD_LABELS[seller.method] }],
    footer: `사장님 ${seller.id}`,
    at: seller.createdAt,
  });
}

/** 새 스토어 등록 — 상품이 올라가야 손님에게 보인다 */
export function buildNewStoreMessage(store: NewStoreAlert, ctx: OpsAlertContext) {
  return embed(ctx, {
    title: "새 스토어 등록",
    hint: "처음 상품 등록을 도와 드리면 손님 화면에 보여요.",
    path: "/seller/stores",
    fields: [
      { name: "스토어", value: plainText(store.name) },
      { name: "동네", value: regionOf(store.roadAddress || store.address) },
    ],
    footer: `스토어 ${store.id}`,
    at: store.createdAt,
  });
}

/** 손님이 지도에서 입점을 요청한 가게 — "손님이 사장님 가게를 원했어요"로 연락할 이유가 생긴다 */
export function buildNewStoreEntryRequestMessage(
  req: NewStoreEntryRequestAlert,
  ctx: OpsAlertContext,
) {
  // 카카오 업종은 "음식 > 간식 > 제과,베이커리"처럼 온다 — 마지막 단계만
  const category = plainText((req.categoryName ?? "").split(">").pop()) || "-";
  return embed(ctx, {
    title: "손님이 입점을 요청한 가게",
    hint: '"손님이 사장님 가게를 원했어요"로 연락해 보세요.',
    path: "/statistics/store-entry-requests",
    fields: [
      { name: "가게", value: plainText(req.placeName) },
      { name: "동네", value: regionOf(req.roadAddress || req.address) },
      { name: "업종", value: category },
      { name: "이 가게 요청", value: `${req.requestCount}명` },
    ],
    footer: "입점 요청",
    at: req.createdAt,
  });
}

export const CHAT_REPORT_REASON_LABELS = {
  ABUSE: "욕설·비방·괴롭힘",
  SEXUAL: "음란·불쾌한 사진",
  SPAM: "광고·도배",
  FRAUD: "사기가 의심돼요",
  OTHER: "그 밖의 이유",
} as const;

export interface ChatReportAlert {
  id: string;
  reason: keyof typeof CHAT_REPORT_REASON_LABELS;
  /** 누가 신고했나: 손님 / 가게 */
  reporter: "CONSUMER" | "SHOP";
  createdAt: Date;
}

/**
 * 채팅 신고(기획 I-11, 애플 심사 지침 1.2) — 24시간 안에 확인해야 한다.
 * 대화 내용·이름은 넣지 않고 관리자 신고 화면 링크만(열면 열람 기록이 남는다).
 */
export function buildChatReportMessage(report: ChatReportAlert, ctx: OpsAlertContext) {
  return embed(ctx, {
    title: report.reason === "FRAUD" ? "채팅 신고 — 사기 의심" : "채팅 신고",
    hint: "24시간 안에 확인해 가리거나 막아 주세요.",
    path: `/chat-reports/${encodeURIComponent(report.id)}`,
    fields: [
      { name: "사유", value: CHAT_REPORT_REASON_LABELS[report.reason] },
      { name: "신고한 쪽", value: report.reporter === "CONSUMER" ? "손님" : "가게" },
    ],
    footer: `신고 ${report.id}`,
    at: report.createdAt,
  });
}
