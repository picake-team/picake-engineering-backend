/**
 * 견적 요청서 참고 사진 읽기(기획 I-112 1-나 / I-46 ③). 손님이 올린 케이크 사진을 Claude가 읽어 요청서 칸을 채운다.
 * 사진은 저장하지 않고, 사진·읽은 내용은 로그에 남기지 않는다(횟수·시간·토큰만).
 */

/** 사진을 읽는 가장 싼 모델(상세 설명 AI 초안 P-62와 같은 Haiku) */
export const QUOTE_PHOTO_READ_MODEL = "claude-haiku-5-5";

export const QUOTE_PHOTO_READ_LIMITS = {
  /** 웹이 1280px·품질 0.8로 줄여 보내므로 보통 수백 KB. 그보다 훨씬 큰 사진은 받지 않는다 */
  MAX_IMAGE_BYTES: Math.floor(2.5 * 1024 * 1024),
  /** 하루(한국 시간) 사진 읽기 횟수: 로그인하면 손님마다, 아니면 접속 주소마다 */
  DAILY_PER_CLIENT: 20,
  /** 읽은 줄 7개 + 문장 하나면 수백 토큰. 넘치면 잘린 응답 대신 못 읽음으로 */
  MAX_OUTPUT_TOKENS: 1024,
  /** 요청서 설명 칸에 넣는 한 문장 */
  DESCRIPTION_MAX_LENGTH: 180,
  /** 읽은 줄·따를 것 한 칸 */
  VALUE_MAX_LENGTH: 80,
  /** 요청 사항(요청서 요청 사항 칸 200자보다 짧게) */
  REQUEST_NOTE_MAX_LENGTH: 100,
  /** 큰 사진을 받는 이 경로만 JSON 본문 한도를 올린다(base64는 원래 크기의 4/3) */
  BODY_LIMIT: "4mb",
} as const;

/** 읽은 줄(이 순서·이 이름으로 웹에 보인다) */
export const QUOTE_PHOTO_READ_ROWS = [
  { key: "shape", label: "모양" },
  { key: "creamColor", label: "크림 색" },
  { key: "border", label: "테두리" },
  { key: "decoration", label: "장식" },
  { key: "lettering", label: "글자" },
  { key: "candlesToppers", label: "초·토퍼" },
  { key: "creamType", label: "크림 종류" },
] as const;
export type QuotePhotoReadRowKey = (typeof QUOTE_PHOTO_READ_ROWS)[number]["key"];

export const QUOTE_PHOTO_READ_ERROR_MESSAGES = {
  INVALID_IMAGE: "JPG나 PNG 사진만 읽을 수 있어요. 다른 사진으로 다시 시도해 주세요.",
  TOO_LARGE: "사진이 너무 커요. 더 작은 사진으로 다시 시도해 주세요.",
  DAILY_LIMIT: "오늘은 사진 읽기를 다 썼어요. 직접 적어 주세요.",
  NOT_CONFIGURED: "지금은 사진을 읽을 수 없어요. 직접 적어 주세요.",
  FAILED: "사진을 읽지 못했어요. 잠시 후 다시 시도하거나 직접 적어 주세요.",
} as const;
