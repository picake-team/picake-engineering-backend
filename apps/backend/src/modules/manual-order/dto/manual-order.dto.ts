import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { ManualOrderSource } from "@apps/backend/infra/database/prisma/generated/client";
import { IsYmdDateString } from "@apps/backend/common/decorators/date-query.decorator";
import {
  MANUAL_ORDER_ERROR_MESSAGES,
  MANUAL_ORDER_LIMITS,
} from "@apps/backend/modules/manual-order/constants/manual-order.constants";

/** "  " → null, 앞뒤 공백은 지운다(선택 칸) */
const trimToNull = ({ value }: { value: unknown }) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 적기·고치기 칸(고치기도 모든 칸을 보낸다) */
export class ManualOrderInputDto {
  @ApiProperty({ description: "픽업 날 YYYY-MM-DD(Asia/Seoul)", example: "2026-12-24" })
  @IsYmdDateString({ message: MANUAL_ORDER_ERROR_MESSAGES.INVALID_DATE })
  pickupDate!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "픽업 시각 HH:mm, 모르면 null",
    example: "12:00",
  })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(HH_MM, { message: MANUAL_ORDER_ERROR_MESSAGES.INVALID_TIME })
  pickupTime?: string | null;

  @ApiProperty({ description: "케이크(크기·맛·디자인을 한 줄로)", example: "2호 초코 리스" })
  @Transform(trimToNull)
  @IsString({ message: MANUAL_ORDER_ERROR_MESSAGES.CAKE_NAME_REQUIRED })
  @IsNotEmpty({ message: MANUAL_ORDER_ERROR_MESSAGES.CAKE_NAME_REQUIRED })
  @MaxLength(MANUAL_ORDER_LIMITS.CAKE_NAME_MAX)
  cakeName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: "메리 크리스마스 지우야" })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(MANUAL_ORDER_LIMITS.LETTERING_MAX)
  lettering?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "금액(원)", example: 45000 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt({ message: MANUAL_ORDER_ERROR_MESSAGES.INVALID_PRICE })
  @Min(0, { message: MANUAL_ORDER_ERROR_MESSAGES.INVALID_PRICE })
  @Max(MANUAL_ORDER_LIMITS.PRICE_MAX, { message: MANUAL_ORDER_ERROR_MESSAGES.INVALID_PRICE })
  price?: number | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: "입금: true 받음, false 아직, null 고르지 않음",
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  paid?: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "손님", example: "한지우" })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(MANUAL_ORDER_LIMITS.CUSTOMER_NAME_MAX)
  customerName?: string | null;

  @ApiProperty({ enum: ManualOrderSource, description: "받은 곳" })
  @IsEnum(ManualOrderSource)
  source!: ManualOrderSource;

  @ApiPropertyOptional({ type: String, nullable: true, example: "초 큰 거 2개, 보냉백" })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(MANUAL_ORDER_LIMITS.MEMO_MAX)
  memo?: string | null;

  @ApiPropertyOptional({ type: [String], description: "업로드 API로 올린 사진 주소(3장까지)" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MANUAL_ORDER_LIMITS.PHOTO_MAX, {
    message: MANUAL_ORDER_ERROR_MESSAGES.TOO_MANY_PHOTOS,
  })
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  photoUrls?: string[];
}

/** 입금만 바로 바꾸기(상세 화면) */
export class ManualOrderPaidInputDto {
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: "true 받음, false 아직, null 고르지 않음",
  })
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  paid!: boolean | null;
}

export class ManualOrderListQueryDto {
  @ApiProperty({ description: "시작 픽업 날 YYYY-MM-DD", example: "2026-12-01" })
  @IsYmdDateString()
  startDate!: string;

  @ApiProperty({ description: "끝 픽업 날 YYYY-MM-DD(그날 포함)", example: "2026-12-31" })
  @IsYmdDateString()
  endDate!: string;
}

export class ManualOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: "2026-12-24" }) pickupDate!: string;
  @ApiProperty({ type: String, nullable: true, example: "12:00" }) pickupTime!: string | null;
  @ApiProperty() cakeName!: string;
  @ApiProperty({ type: String, nullable: true }) lettering!: string | null;
  @ApiProperty({ type: Number, nullable: true }) price!: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) paid!: boolean | null;
  @ApiProperty({ type: String, nullable: true }) customerName!: string | null;
  @ApiProperty({ enum: ManualOrderSource }) source!: ManualOrderSource;
  @ApiProperty({ type: String, nullable: true }) memo!: string | null;
  @ApiProperty({ type: [String] }) photoUrls!: string[];
  @ApiProperty({ description: "운영자가 가게 대신 적은 주문이면 true(기획 I-41)" })
  enteredByOperator!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ManualOrderListResponseDto {
  @ApiProperty({
    type: [ManualOrderDto],
    description: "픽업 날·시각 순(시각 없는 주문은 그날 맨 뒤)",
  })
  data!: ManualOrderDto[];
}

/** 대화 읽기: 글 또는 캡처 하나 */
export class ManualOrderReadRequestDto {
  @ApiPropertyOptional({ description: "붙여 넣은 대화 글. 저장하지 않는다" })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    description: "대화 캡처 JPG·PNG data URL(풀었을 때 2.5MB까지). 저장하지 않는다",
  })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({
    description:
      "오늘 날짜 YYYY-MM-DD(사장님 휴대폰 기준). '이번 주 토요일' 같은 말을 날짜로 바꿀 때 쓴다",
  })
  @IsOptional()
  @IsYmdDateString()
  today?: string;
}

export class ManualOrderReadResponseDto {
  @ApiProperty({ description: "주문으로 읽을 내용이 없으면 false(다른 칸은 모두 null)" })
  found!: boolean;
  @ApiProperty({ type: String, nullable: true }) pickupDate!: string | null;
  @ApiProperty({ type: String, nullable: true }) pickupTime!: string | null;
  @ApiProperty({ type: String, nullable: true }) cakeName!: string | null;
  @ApiProperty({ type: String, nullable: true, description: "대화에 쓰인 글자 그대로" })
  lettering!: string | null;
  @ApiProperty({ type: Number, nullable: true }) price!: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) paid!: boolean | null;
  @ApiProperty({ type: String, nullable: true }) customerName!: string | null;
  @ApiProperty({ enum: ManualOrderSource, nullable: true }) source!: ManualOrderSource | null;
  @ApiProperty({ type: String, nullable: true }) memo!: string | null;
}

/** 다른 캘린더로 내보내기 */
export class CalendarFeedDto {
  @ApiProperty({
    description: "구독 주소의 경로(API 주소 뒤에 붙인다). 아이폰은 webcal://, 구글은 cid로 연다",
    example: "/v1/seller/calendar-feeds/AbC123.ics",
  })
  path!: string;

  @ApiProperty({ description: "일정 이름에 손님 이름을 붙일지" })
  showCustomerName!: boolean;
}

export class CalendarFeedSettingsInputDto {
  @ApiProperty()
  @IsBoolean()
  showCustomerName!: boolean;
}
