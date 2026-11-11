import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from "class-validator";
import { CHAT_LIMITS } from "@apps/backend/modules/chat/constants/chat.constants";

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === "true" || value === "1"
    ? true
    : value === false || value === "false" || value === "0"
      ? false
      : value;

/** 글 보내기(손님·사장님 공통) */
export class ChatSendDto {
  @ApiProperty({
    description:
      "폰이 만든 메시지 번호(8~64자). 다시 보내기를 해도 같은 번호면 한 번만 저장됩니다.",
  })
  @IsString()
  @Length(8, 64)
  clientId: string;

  @ApiPropertyOptional({ description: `글(최대 ${CHAT_LIMITS.TEXT_MAX}자)` })
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_LIMITS.TEXT_MAX)
  text?: string;

  @ApiPropertyOptional({
    type: [String],
    description: `업로드 API로 올린 사진 주소(한 번에 ${CHAT_LIMITS.IMAGES_MAX}장까지)`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHAT_LIMITS.IMAGES_MAX)
  @IsString({ each: true })
  imageUrls?: string[];
}

/** 손님이 가게에 처음 보내기(방은 첫 글을 보낼 때 생긴다). 주문·상품에서 열었으면 그 카드가 먼저 붙는다 */
export class ConsumerStartChatDto extends ChatSendDto {
  @ApiProperty({ description: "스토어 ID" })
  @IsString()
  storeId: string;

  @ApiPropertyOptional({ description: "주문 상세에서 열었으면 그 주문 ID(내 주문만)" })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ description: "상품에서 열었으면 그 상품 ID(이 스토어 상품만)" })
  @IsOptional()
  @IsString()
  productId?: string;
}

/** 사장님이 픽업 전 예약 손님에게 먼저 보내기(운영자 결정 11-11) */
export class SellerStartChatFromOrderDto extends ChatSendDto {}

export class ChatListQueryDto {
  @ApiPropertyOptional({ description: "이 시각보다 오래된 방부터(다음 쪽, ISO)" })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    enum: ["reply", "all"],
    description: "사장님: 답할 것(마지막 글이 손님 것) / 전체",
  })
  @IsOptional()
  @IsIn(["reply", "all"])
  filter?: "reply" | "all";
}

export class ChatMessagesQueryDto {
  @ApiPropertyOptional({ description: "이 메시지 다음 것만(새 글 확인)" })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiPropertyOptional({ description: "이 메시지보다 앞 것(위로 더 보기)" })
  @IsOptional()
  @IsString()
  before?: string;

  @ApiPropertyOptional({ description: "true면 읽음·보고 있음으로 저장(방이 화면에 보일 때)" })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  markRead?: boolean;
}

export class ChatToggleDto {
  @ApiProperty()
  @IsBoolean()
  value: boolean;
}

export const CHAT_REPORT_REASONS = ["ABUSE", "SEXUAL", "SPAM", "FRAUD", "OTHER"] as const;
export type ChatReportReasonValue = (typeof CHAT_REPORT_REASONS)[number];

export class ChatReportDto {
  @ApiProperty({ enum: CHAT_REPORT_REASONS })
  @IsIn(CHAT_REPORT_REASONS as unknown as string[])
  reason: ChatReportReasonValue;

  @ApiPropertyOptional({ description: "자세히(선택, 500자)" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;

  @ApiPropertyOptional({ description: "신고할 메시지(없으면 방 전체)" })
  @IsOptional()
  @IsString()
  messageId?: string;
}

export class ChatRulesAgreeDto {
  @ApiProperty({ description: "동의한 규칙 버전" })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}

/** --- 응답 --- */

export class ChatCardDto {
  @ApiProperty({ enum: ["ORDER", "PRODUCT"] })
  type: "ORDER" | "PRODUCT";
  @ApiProperty()
  refId: string;
  @ApiProperty({ description: "카드 제목(상품 이름)" })
  title: string;
  @ApiPropertyOptional({ description: "주문: 주문번호·픽업 일시 / 상품: 가격" })
  subtitle?: string | null;
  @ApiPropertyOptional()
  imageUrl?: string | null;
  @ApiPropertyOptional({ description: "주문 카드: 지금 주문 상태(열 때마다 새로 읽음)" })
  orderStatus?: string | null;
  @ApiPropertyOptional({ description: "상품 카드: 지금 팔고 있지 않으면 false" })
  available?: boolean;
}

export class ChatMessageDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  clientId: string;
  @ApiProperty({ enum: ["CONSUMER", "SHOP", "SYSTEM"] })
  sender: "CONSUMER" | "SHOP" | "SYSTEM";
  @ApiProperty({ description: "내가 보낸 글인가(보는 사람 기준)" })
  mine: boolean;
  @ApiProperty({ enum: ["TEXT", "IMAGE", "ORDER", "PRODUCT"] })
  kind: "TEXT" | "IMAGE" | "ORDER" | "PRODUCT";
  @ApiPropertyOptional({ description: "보이는 글(거른 글). 가려졌으면 null" })
  text: string | null;
  @ApiProperty({ type: [String] })
  imageUrls: string[];
  @ApiPropertyOptional({ type: ChatCardDto })
  card?: ChatCardDto | null;
  @ApiProperty({ description: "운영자가 신고 처리로 가림" })
  hidden: boolean;
  @ApiProperty()
  createdAt: string;
}

export class ChatWriteStateDto {
  @ApiProperty()
  ok: boolean;
  @ApiPropertyOptional({ description: "못 쓸 때 안내 글" })
  message?: string | null;
}

export class ChatThreadDto {
  @ApiProperty()
  id: string;
  @ApiProperty({ description: "스토어 ID(가게가 떠났으면 null)" })
  storeId: string | null;
  @ApiProperty({ description: "가게 이름(손님 화면) 또는 손님 닉네임(사장님 화면)" })
  title: string;
  @ApiPropertyOptional({
    description: "가게 로고(손님 화면). 사장님 화면에는 손님 사진을 주지 않음",
  })
  imageUrl?: string | null;
  @ApiPropertyOptional()
  lastMessageAt: string | null;
  @ApiPropertyOptional()
  lastMessagePreview: string | null;
  @ApiProperty({ description: "내가 안 읽은 글이 있음" })
  unread: boolean;
  @ApiProperty({ description: "사장님: 마지막 글이 손님 것(답할 것)" })
  needsReply: boolean;
  @ApiProperty()
  muted: boolean;
  @ApiProperty({ description: "내가 차단함" })
  blockedByMe: boolean;
}

export class ChatThreadDetailDto extends ChatThreadDto {
  @ApiProperty({ type: ChatWriteStateDto })
  write: ChatWriteStateDto;
  @ApiPropertyOptional({ description: "상대가 마지막으로 읽은 시각(내 글의 '읽음')" })
  otherReadAt: string | null;
  @ApiProperty({ description: "채팅 이용 규칙에 동의했나" })
  rulesAgreed: boolean;
  @ApiProperty({ description: "규칙 버전" })
  rulesVersion: number;
  @ApiProperty({ description: "입점 전 가게 방인가(1단계에서는 항상 false)" })
  unenteredShop: boolean;
}

export class ChatThreadListDto {
  @ApiProperty({ type: [ChatThreadDto] })
  threads: ChatThreadDto[];
  @ApiPropertyOptional({ description: "다음 쪽 커서(없으면 끝)" })
  nextCursor: string | null;
}

export class ChatMessagesDto {
  @ApiProperty({ type: [ChatMessageDto] })
  messages: ChatMessageDto[];
  @ApiProperty({ description: "위로 더 있음(before로 가져올 때)" })
  hasMore: boolean;
  @ApiProperty({ type: ChatThreadDetailDto })
  thread: ChatThreadDetailDto;
}

export class ChatSendResultDto {
  @ApiProperty({
    type: ChatMessageDto,
    isArray: true,
    description: "저장된 글(카드가 같이 붙었으면 카드 먼저)",
  })
  messages: ChatMessageDto[];
  @ApiProperty()
  threadId: string;
}

export class ChatStatusDto {
  @ApiProperty({ description: "채팅이 열렸나(관리자 설정의 여는 시각)" })
  open: boolean;
  @ApiProperty({ description: "채팅 이용 규칙 버전" })
  rulesVersion: number;
}

export class ChatUnreadDto {
  @ApiProperty()
  open: boolean;
  @ApiProperty({ description: "안 읽은 방 수" })
  unreadThreads: number;
  @ApiPropertyOptional({ description: "사장님: 답할 방 수" })
  replyNeeded?: number;
}

export class ChatExistingThreadDto {
  @ApiPropertyOptional({ description: "이미 있는 방(없으면 null — 첫 글을 보낼 때 생김)" })
  threadId: string | null;
  @ApiProperty({ description: "가게 이름 또는 손님 닉네임" })
  title: string;
  @ApiProperty({ type: ChatWriteStateDto })
  write: ChatWriteStateDto;
  @ApiProperty()
  rulesAgreed: boolean;
  @ApiProperty()
  rulesVersion: number;
}

/** 관리자 */
export class AdminChatReportListQueryDto {
  @ApiPropertyOptional({ enum: ["OPEN", "RESOLVED"] })
  @IsOptional()
  @IsIn(["OPEN", "RESOLVED"])
  status?: "OPEN" | "RESOLVED";
}

export class AdminChatReportResolveDto {
  @ApiProperty({
    enum: ["HIDE_MESSAGE", "NONE"],
    description: "신고된 메시지 가리기 / 그대로 두기",
  })
  @IsIn(["HIDE_MESSAGE", "NONE"])
  action: "HIDE_MESSAGE" | "NONE";

  @ApiPropertyOptional({
    type: [String],
    description:
      "가릴 메시지(이 방의 것, 50개까지). 없으면 신고된 메시지 하나. 방 전체 신고는 운영자가 대화에서 고른다",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  messageIds?: string[];

  @ApiPropertyOptional({ description: "처리 메모(200자)" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class AdminChatOpenDto {
  @ApiPropertyOptional({ description: "채팅 여는 시각(ISO). null이면 닫음", nullable: true })
  @IsOptional()
  @IsString()
  chatOpensAt?: string | null;
}
