import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import {
  QuoteRequestEntry,
  QuoteRequestStatus,
  QuoteRequestStoreAddedBy,
} from "@apps/backend/infra/database/prisma/generated/client";
import { PaginationMetaResponseDto } from "@apps/backend/common/dto/pagination-response.dto";
import {
  QuoteRequestDetailDto,
  QuoteRequestListItemDto,
  QuoteRequestStoreResponseDto,
} from "@apps/backend/modules/quote-request/dto/quote-request.dto";

export class AdminQuoteRequestListQueryDto {
  @ApiPropertyOptional({
    enum: QuoteRequestStatus,
    description:
      "OPEN = 견적 받는 중(마감 전), CONNECTED = 가게 연결, CLOSED = 마감(마감이 지난 OPEN 포함). 없으면 전체",
  })
  @IsOptional()
  @IsEnum(QuoteRequestStatus)
  status?: QuoteRequestStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** 요청한 손님(운영자만 봄, 가게·디스코드에는 보내지 않음) */
export class AdminQuoteRequestConsumerDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  nickname: string | null;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ description: "휴대폰 번호" })
  phone: string;
}

export class AdminQuoteRequestListItemDto extends QuoteRequestListItemDto {
  @ApiProperty({ description: "손님이 넣은 가게 수" })
  storeCount: number;

  @ApiProperty({ description: "참고 사진 수" })
  photoCount: number;

  @ApiProperty({ enum: QuoteRequestEntry, nullable: true })
  entry: QuoteRequestEntry | null;
}

export class AdminQuoteRequestStoreResponseDto extends QuoteRequestStoreResponseDto {
  @ApiProperty({ enum: QuoteRequestStoreAddedBy })
  addedBy: QuoteRequestStoreAddedBy;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  placeUrl: string | null;

  @ApiProperty({ nullable: true })
  latitude: number | null;

  @ApiProperty({ nullable: true })
  longitude: number | null;
}

export class AdminQuoteRequestDetailDto extends QuoteRequestDetailDto {
  @ApiProperty({ type: [AdminQuoteRequestStoreResponseDto] })
  declare stores: AdminQuoteRequestStoreResponseDto[];

  @ApiProperty({ type: AdminQuoteRequestConsumerDto })
  consumer: AdminQuoteRequestConsumerDto;

  @ApiProperty({ nullable: true, description: "동네 중심 위도" })
  areaLatitude: number | null;

  @ApiProperty({ nullable: true, description: "동네 중심 경도" })
  areaLongitude: number | null;

  @ApiProperty({ enum: QuoteRequestEntry, nullable: true })
  entry: QuoteRequestEntry | null;
}

export class AdminQuoteRequestListResponseDto {
  @ApiProperty({ type: [AdminQuoteRequestListItemDto] })
  data: AdminQuoteRequestListItemDto[];

  @ApiProperty({ type: PaginationMetaResponseDto })
  meta: PaginationMetaResponseDto;
}
