import { QuoteRequestEntry } from "@apps/backend/infra/database/prisma/generated/client";
import { QUOTE_REQUEST_ENTRY_LABELS } from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import type { QuoteRequestRow } from "@apps/backend/modules/quote-request/utils/quote-request-mapper.util";
import { buildSummary } from "@apps/backend/modules/quote-request/utils/quote-request-mapper.util";

/** 디스코드 embed 한 칸 최대 1,024자 */
const FIELD_MAX = 1024;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 새 견적 요청 디스코드 알림(【PICAKE】운영). 운영자가 몇 시간 안에 가게에 물어봐야 해서 바로 보낸다.
 * 손님 이름·연락처·사진과 손님이 쓴 글(설명·요청 사항)은 넣지 않는다(기획 I-46 SC-45). 자세한 내용은 관리자 화면 링크로 연다.
 */
export function buildNewQuoteRequestDiscordMessage(
  row: QuoteRequestRow,
  options: { adminDomain?: string | null; environmentLabel?: string | null },
) {
  const summary = buildSummary(row);
  const stores =
    row.stores.length === 0
      ? "없음(근처 가게를 찾아 물어보기)"
      : row.stores.map((s) => `${s.name}${s.storeId ? "" : "(입점 전)"}`).join(", ");
  // 손님이 쓴 설명·요청 사항은 디스코드에 보내지 않는다(다른 사람 이름이 들어갈 수 있다). 관리자 상세에서 본다
  const design = [
    row.photoUrls.length > 0 ? `참고 사진 ${row.photoUrls.length}장` : null,
    row.description ? "설명 있음" : null,
    row.requestNote ? "요청 사항 있음" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const env = options.environmentLabel ? `[${options.environmentLabel}] ` : "";
  const url = options.adminDomain
    ? `${options.adminDomain.replace(/\/$/, "")}/consumer/quote-requests/${row.id}`
    : undefined;

  const fields = [
    { name: "픽업", value: summary.pickup, inline: true },
    { name: "받을 동네", value: summary.area, inline: true },
    { name: "케이크", value: summary.cake, inline: true },
    { name: "예산", value: summary.budget, inline: true },
    { name: "견적 마감", value: summary.deadline, inline: true },
    {
      name: "들어온 곳",
      value: row.entry ? QUOTE_REQUEST_ENTRY_LABELS[row.entry as QuoteRequestEntry] : "-",
      inline: true,
    },
    { name: "디자인", value: design || "-", inline: false },
    { name: "꼭 물어볼 가게", value: stores, inline: false },
  ].map((f) => ({ ...f, value: clip(f.value, FIELD_MAX) }));

  return {
    embeds: [
      {
        title: `${env}새 견적 요청`,
        description: url
          ? `[관리자에서 열기](${url}) · 견적 마감 전에 가게에 물어봐 주세요.`
          : "견적 마감 전에 가게에 물어봐 주세요.",
        url,
        color: 0xff653e,
        fields,
        footer: { text: `요청 ${row.id}` },
        timestamp: row.createdAt.toISOString(),
      },
    ],
  };
}
