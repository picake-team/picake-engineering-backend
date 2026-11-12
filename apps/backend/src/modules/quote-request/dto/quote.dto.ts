import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  QuoteDeclineReason,
  QuoteSimilarity,
  QuoteSource,
} from "@apps/backend/infra/database/prisma/generated/client";
import {
  QUOTE_CONTACT_TYPES,
  QUOTE_LIMITS,
  type QuoteContactType,
} from "@apps/backend/modules/quote-request/constants/quote.constants";

// ───────────────────────── 입력 ─────────────────────────

/** 견적 보내기·고치기(견적 링크·판매자 앱·운영자 대신 적기가 같은 칸) */
export class QuoteInputDto {
  @ApiProperty({ description: "1개 금액(원)", example: 58000 })
  @Type(() => Number)
  @IsInt()
  @Min(QUOTE_LIMITS.UNIT_PRICE_MIN)
  @Max(QUOTE_LIMITS.UNIT_PRICE_MAX)
  unitPrice!: number;

  @ApiPropertyOptional({ description: "디자인을 보고 달라질 수 있어요" })
  @IsOptional()
  @IsBoolean()
  priceMayVary?: boolean;

  @ApiProperty({ enum: QuoteSimilarity })
  @IsEnum(QuoteSimilarity)
  similarity!: QuoteSimilarity;

  /**
   * 쓰지 않음(운영자 2026-11-12: 주문 받는 곳을 묻지 않고 채팅에서 정함).
   * 바뀌기 전 화면이 보내도 받기만 하고 저장하지 않는다. 화면이 다 바뀐 뒤 지운다
   */
  @ApiPropertyOptional({ deprecated: true, description: "쓰지 않음. 보내도 저장하지 않음" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(QUOTE_CONTACT_TYPES.length)
  contacts?: unknown[];

  @ApiPropertyOptional({ maxLength: QUOTE_LIMITS.MEMO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_LIMITS.MEMO_MAX_LENGTH)
  memo?: string;

  @ApiPropertyOptional({ type: [String], description: "비슷하게 만든 케이크 사진(3장까지)" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(QUOTE_LIMITS.MAX_PHOTOS)
  @IsString({ each: true })
  photoUrls?: string[];
}

export class QuoteDeclineInputDto {
  @ApiProperty({ enum: QuoteDeclineReason })
  @IsEnum(QuoteDeclineReason)
  reason!: QuoteDeclineReason;
}

export class ChooseQuoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  quoteId!: string;
}

// ───────────────────────── 응답 ─────────────────────────

export class QuoteContactDto {
  @ApiProperty({ enum: QUOTE_CONTACT_TYPES }) type!: QuoteContactType;
  @ApiProperty() label!: string;
  @ApiProperty() value!: string;
  @ApiProperty({ description: "누르면 열 주소(전화는 tel:)" }) href!: string;
}

export class QuoteDto {
  @ApiProperty() id!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty({ nullable: true, type: String }) storeId!: string | null;
  @ApiProperty() isPicakeStore!: boolean;
  @ApiProperty({ nullable: true, type: String }) logoImageUrl!: string | null;
  @ApiProperty({ enum: QuoteSource }) source!: QuoteSource;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() total!: number;
  @ApiProperty() priceMayVary!: boolean;
  @ApiProperty({ enum: QuoteSimilarity }) similarity!: QuoteSimilarity;
  @ApiProperty() similarityLabel!: string;
  @ApiProperty() similarityDetail!: string;
  @ApiProperty({
    type: [QuoteContactDto],
    deprecated: true,
    description: "쓰지 않음(늘 빈 목록, 바뀌기 전 화면 호환용 — 주문은 채팅에서)",
  })
  contacts!: QuoteContactDto[];
  @ApiProperty({ nullable: true, type: String }) memo!: string | null;
  @ApiProperty({ type: [String] }) photoUrls!: string[];
  @ApiProperty({ description: "처음 보낸 뒤 고침" }) edited!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

/** 손님 화면의 견적 한 장 */
export class ConsumerQuoteDto extends QuoteDto {
  @ApiProperty({ description: "손님이 아직 보지 않은 견적(처음 열기 전)" }) unseen!: boolean;
  @ApiProperty() chosen!: boolean;
  @ApiProperty() canChoose!: boolean;
  @ApiProperty({ nullable: true, type: String, description: "이 가게와의 채팅방" })
  threadId!: string | null;
}

/** 어려워요로 답한 가게. 이유는 손님에게 주지 않는다("이번 요청은 어렵대요"만, SC-19 ③) */
export class DeclinedTargetDto {
  @ApiProperty() targetId!: string;
  @ApiProperty() storeName!: string;
}

/** 요청 상세에 붙는 견적 묶음(SC-18) */
export class ConsumerQuoteSectionDto {
  @ApiProperty({ type: [ConsumerQuoteDto] }) quotes!: ConsumerQuoteDto[];
  @ApiProperty({ type: [DeclinedTargetDto] }) declined!: DeclinedTargetDto[];
  @ApiProperty({ description: "Picake가 실제로 물어본 가게 수(링크를 보냈거나 앱으로 보냄)" })
  askedCount!: number;
  @ApiProperty({ nullable: true, type: String }) chosenTargetId!: string | null;
  @ApiProperty({ nullable: true, type: Date }) chosenAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date, description: "다시 고를 수 있는 마지막 때" })
  rechooseUntil!: Date | null;
}

export class ChooseQuoteResponseDto {
  @ApiProperty() requestId!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty({ nullable: true, type: String }) threadId!: string | null;
}

/** 견적 링크·판매자 앱에서 이 가게 쪽 상태 */
export const QUOTE_TARGET_STATES = [
  "OPEN",
  "SENT",
  "DECLINED",
  "CHOSEN_ME",
  "CHOSEN_OTHER",
  "CLOSED",
  "FULL",
] as const;
export type QuoteTargetState = (typeof QUOTE_TARGET_STATES)[number];

export class QuoteRequestForShopDto {
  @ApiProperty() requestId!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() pickup!: string;
  @ApiProperty() cake!: string;
  @ApiProperty() budget!: string;
  @ApiProperty({ nullable: true, type: String }) area!: string | null;
  @ApiProperty() deadline!: string;
  @ApiProperty() deadlineAt!: Date;
  @ApiProperty() quantity!: number;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) requestNote!: string | null;
  @ApiProperty({ type: [String] }) photoUrls!: string[];
  @ApiProperty({ enum: QUOTE_TARGET_STATES }) state!: QuoteTargetState;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ nullable: true, type: QuoteDto }) quote!: QuoteDto | null;
  @ApiProperty({ nullable: true, enum: QuoteDeclineReason })
  declineReason!: QuoteDeclineReason | null;
  @ApiProperty({
    type: [QuoteContactDto],
    deprecated: true,
    description: "쓰지 않음(늘 빈 목록, 바뀌기 전 화면 호환용)",
  })
  prefillContacts!: QuoteContactDto[];
}

/** 견적 링크(가입 없이, SC-19). 입점 전 가게 대화 상태를 함께 */
export class QuoteLinkViewDto extends QuoteRequestForShopDto {
  @ApiProperty({ description: "입점 안내를 보일지(입점 전 가게)" }) showEntryGuide!: boolean;
  @ApiProperty({ nullable: true, type: String }) threadId!: string | null;
  @ApiProperty({ description: "링크 안 대화를 쓸 수 있나" }) chatOpen!: boolean;
  @ApiProperty({ nullable: true, type: Date }) chatOpenUntil!: Date | null;
}

/** 관리자 상세의 가게 한 줄 상태(SC-46 ④) */
export class AdminQuoteTargetStatusDto {
  @ApiProperty() targetId!: string;
  @ApiProperty({ nullable: true, type: String }) linkUrl!: string | null;
  @ApiProperty({ nullable: true, type: Date }) linkCreatedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) linkOpenedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) sentToAppAt!: Date | null;
  @ApiProperty({ enum: QUOTE_TARGET_STATES }) state!: QuoteTargetState;
  @ApiProperty({ nullable: true, type: QuoteDto }) quote!: QuoteDto | null;
  @ApiProperty({ nullable: true, enum: QuoteDeclineReason })
  declineReason!: QuoteDeclineReason | null;
  @ApiProperty({ description: "대화 있음(내용은 보이지 않음)" }) hasChat!: boolean;
  @ApiProperty({ description: "손님 마지막 글에 가게가 아직 답하지 않음" })
  awaitingShopReply!: boolean;
}

export class AdminQuoteSectionDto {
  @ApiProperty({ type: [AdminQuoteTargetStatusDto] }) targets!: AdminQuoteTargetStatusDto[];
  @ApiProperty({ nullable: true, type: String }) chosenTargetId!: string | null;
  @ApiProperty({ nullable: true, type: Date }) chosenAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) chosenNotifiedAt!: Date | null;
  @ApiProperty() chosenIsUnentered!: boolean;
  @ApiProperty() chosenStalled!: boolean;
}
