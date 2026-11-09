import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import {
  QuoteCakeSize,
  QuoteCream,
  QuoteRequestCloseReason,
  QuoteRequestEntry,
  QuoteRequestStatus,
} from "@apps/backend/infra/database/prisma/generated/client";
import { IsYmdDateString } from "@apps/backend/common/decorators/date-query.decorator";
import { PaginationMetaResponseDto } from "@apps/backend/common/dto/pagination-response.dto";
import {
  QUOTE_REQUEST_DISTANCE_KM,
  QUOTE_REQUEST_ERROR_MESSAGES,
  QUOTE_REQUEST_LIMITS,
  QUOTE_REQUEST_LIST_TABS,
  type QuoteRequestListTab,
} from "@apps/backend/modules/quote-request/constants/quote-request.constants";

/**
 * 물어볼 가게 하나: Picake 가게(storeId)나 지도에서 찾은 입점 전 가게(kakaoPlaceId + 이름 등) 중 하나
 */
export class QuoteRequestStoreInputDto {
  @ApiPropertyOptional({ description: "Picake 가게 ID" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  storeId?: string;

  @ApiPropertyOptional({ description: "카카오 장소 ID(입점 전 가게)" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  kakaoPlaceId?: string;

  @ApiPropertyOptional({ description: "가게 이름(카카오 장소일 때 필수)", example: "구름베이커리" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: "주소(카카오 장소)" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: "전화번호(카카오 장소)" })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ description: "카카오 장소 URL" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  placeUrl?: string;
}

/**
 * 견적 요청서 보내기(기획 I-46 요청서 표)
 */
export class CreateQuoteRequestDto {
  @ApiProperty({ description: "픽업 날짜(한국 날짜)", example: "2026-12-24" })
  @IsYmdDateString()
  pickupDate: string;

  @ApiPropertyOptional({ description: "픽업 시간 '부터'(0~23시). 없으면 아무 때나", example: 14 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  pickupHourFrom?: number;

  @ApiPropertyOptional({ description: "픽업 시간 '까지'(1~24시)", example: 17 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  pickupHourTo?: number;

  @ApiPropertyOptional({
    description: "가게 화면에서 '이 가게에만 물어보기'를 골랐는지",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  onlyDesignatedStores?: boolean;

  @ApiPropertyOptional({ description: "받을 동네 이름", example: "연남동" })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  areaName?: string;

  @ApiPropertyOptional({ description: "그 동네의 시·도", example: "서울" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  areaSido?: string;

  @ApiPropertyOptional({ description: "동네 중심 위도(기기 좌표가 아니라 동네 좌표)" })
  @IsOptional()
  @IsLatitude()
  areaLatitude?: number;

  @ApiPropertyOptional({ description: "동네 중심 경도" })
  @IsOptional()
  @IsLongitude()
  areaLongitude?: number;

  @ApiPropertyOptional({ description: "거리(km)", enum: QUOTE_REQUEST_DISTANCE_KM, example: 3 })
  @IsOptional()
  @IsIn(QUOTE_REQUEST_DISTANCE_KM)
  distanceKm?: number;

  @ApiPropertyOptional({ description: "동네의 시·도 전체에 물어보기(distanceKm 대신)" })
  @IsOptional()
  @IsBoolean()
  wholeSido?: boolean;

  @ApiPropertyOptional({
    type: [QuoteRequestStoreInputDto],
    description: "꼭 물어볼 가게(5곳까지)",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(QUOTE_REQUEST_LIMITS.MAX_STORES)
  @ValidateNested({ each: true })
  @Type(() => QuoteRequestStoreInputDto)
  stores?: QuoteRequestStoreInputDto[];

  @ApiPropertyOptional({ description: "디자인 설명(레터링 포함, 500자까지)" })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_REQUEST_LIMITS.DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "참고 사진 URL(업로드 API로 받은 URL, 3장까지)",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(QUOTE_REQUEST_LIMITS.MAX_PHOTOS)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  photoUrls?: string[];

  @ApiProperty({ enum: QuoteCakeSize, example: QuoteCakeSize.NO1 })
  @IsEnum(QuoteCakeSize)
  size: QuoteCakeSize;

  @ApiProperty({ description: "개수(1~50)", example: 1 })
  @IsInt()
  @Min(QUOTE_REQUEST_LIMITS.MIN_QUANTITY)
  @Max(QUOTE_REQUEST_LIMITS.MAX_QUANTITY)
  quantity: number;

  @ApiPropertyOptional({ enum: QuoteCream, isArray: true, description: "고르지 않으면 상관없음" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(QuoteCream, { each: true })
  creams?: QuoteCream[];

  @ApiPropertyOptional({ description: "그 밖의 맛(직접 쓰기)", example: "초코 시트" })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_REQUEST_LIMITS.FLAVOR_NOTE_MAX_LENGTH)
  flavorNote?: string;

  @ApiProperty({ description: "예산 최소(1개 기준, 원, 1만원 단위)", example: 30000 })
  @IsInt()
  budgetMin: number;

  @ApiPropertyOptional({
    description: "예산 최대(1개 기준). 없거나 10만원이면 '10만원 이상'",
    example: 50000,
  })
  @IsOptional()
  @IsInt()
  budgetMax?: number;

  @ApiPropertyOptional({ description: "요청 사항(200자까지)" })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_REQUEST_LIMITS.REQUEST_NOTE_MAX_LENGTH)
  requestNote?: string;

  @ApiPropertyOptional({ enum: QuoteRequestEntry, description: "요청서를 연 곳" })
  @IsOptional()
  @IsEnum(QuoteRequestEntry)
  entry?: QuoteRequestEntry;

  @ApiProperty({
    description: "요청 내용과 사진이 가게에 전달되는 것에 동의(true여야 보냄)",
    example: true,
  })
  @IsIn([true], { message: QUOTE_REQUEST_ERROR_MESSAGES.CONSENT_REQUIRED })
  agreed: boolean;
}

export class CreateQuoteRequestResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: "가게에 보여 줄 픽업 시작 시각" })
  pickupStartAt: Date;

  @ApiProperty({ description: "견적 마감" })
  deadlineAt: Date;
}

/** 사람이 읽는 줄(손님 앱·관리자·알림이 같은 문구를 쓴다) */
export class QuoteRequestSummaryDto {
  @ApiProperty({ example: "12월 24일(목) 오후 2시~5시" })
  pickup: string;

  @ApiProperty({ example: "연남동 3km 안" })
  area: string;

  @ApiProperty({ example: "1호 케이크 1개 · 생크림" })
  cake: string;

  @ApiProperty({ example: "3만~5만원" })
  budget: string;

  @ApiProperty({ example: "12월 23일(수) 밤 11시" })
  deadline: string;
}

export class QuoteRequestStoreResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true, description: "Picake 가게면 가게 ID" })
  storeId: string | null;

  @ApiProperty({ nullable: true })
  kakaoPlaceId: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  address: string | null;

  @ApiProperty({ description: "Picake에 입점한 가게인지" })
  isPicakeStore: boolean;
}

/** 손님 "내 견적 요청" 카드 */
export class QuoteRequestListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: QuoteRequestStatus, description: "마감이 지난 OPEN은 CLOSED로 보인다" })
  status: QuoteRequestStatus;

  @ApiProperty({ enum: QuoteRequestCloseReason, nullable: true })
  closeReason: QuoteRequestCloseReason | null;

  @ApiProperty({ example: "2026-12-24" })
  pickupDate: string;

  @ApiProperty({ nullable: true })
  pickupHourFrom: number | null;

  @ApiProperty({ nullable: true })
  pickupHourTo: number | null;

  @ApiProperty()
  pickupStartAt: Date;

  @ApiProperty()
  deadlineAt: Date;

  @ApiProperty({ enum: QuoteCakeSize })
  size: QuoteCakeSize;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ nullable: true, description: "첫 참고 사진" })
  thumbnailUrl: string | null;

  @ApiProperty({ description: "받은 견적 수(금액을 보낸 견적만, 견적 기능이 나오기 전에는 0)" })
  quoteCount: number;

  @ApiProperty({ type: QuoteRequestSummaryDto })
  summary: QuoteRequestSummaryDto;

  @ApiProperty()
  createdAt: Date;
}

/** 손님 요청 상세(요청서 보기 포함) */
export class QuoteRequestDetailDto extends QuoteRequestListItemDto {
  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ type: [String] })
  photoUrls: string[];

  @ApiProperty({ enum: QuoteCream, isArray: true })
  creams: QuoteCream[];

  @ApiProperty({ nullable: true })
  flavorNote: string | null;

  @ApiProperty()
  budgetMin: number;

  @ApiProperty({ nullable: true })
  budgetMax: number | null;

  @ApiProperty({ nullable: true })
  requestNote: string | null;

  @ApiProperty()
  onlyDesignatedStores: boolean;

  @ApiProperty({ nullable: true })
  areaName: string | null;

  @ApiProperty({ nullable: true })
  areaSido: string | null;

  @ApiProperty({ nullable: true })
  distanceKm: number | null;

  @ApiProperty({ type: [QuoteRequestStoreResponseDto], description: "손님이 넣은 가게" })
  stores: QuoteRequestStoreResponseDto[];

  @ApiProperty({ nullable: true })
  closedAt: Date | null;
}

export class QuoteRequestListQueryDto {
  @ApiPropertyOptional({
    enum: QUOTE_REQUEST_LIST_TABS,
    default: "ONGOING",
    description: "진행 중 / 지난 요청",
  })
  @IsOptional()
  @IsIn(QUOTE_REQUEST_LIST_TABS)
  tab?: QuoteRequestListTab = "ONGOING";

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class QuoteRequestTabCountsDto {
  @ApiProperty({ description: "진행 중" })
  ongoing: number;

  @ApiProperty({ description: "지난 요청" })
  past: number;
}

export class QuoteRequestListResponseDto {
  @ApiProperty({ type: [QuoteRequestListItemDto] })
  data: QuoteRequestListItemDto[];

  @ApiProperty({ type: PaginationMetaResponseDto })
  meta: PaginationMetaResponseDto;

  @ApiProperty({ type: QuoteRequestTabCountsDto })
  counts: QuoteRequestTabCountsDto;
}
