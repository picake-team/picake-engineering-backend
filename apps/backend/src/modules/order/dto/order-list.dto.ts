import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsEnum, IsDateString } from "class-validator";
import { IsYmdDateString } from "@apps/backend/common/decorators/date-query.decorator";
import {
  OrderStatus,
  OrderSortBy,
  OrderType,
} from "@apps/backend/modules/order/constants/order.constants";
import { SWAGGER_EXAMPLES as STORE_SWAGGER_EXAMPLES } from "@apps/backend/modules/store/constants/store.constants";
import { PaginationRequestDto } from "@apps/backend/common/dto/pagination-request.dto";
import { PaginationMetaResponseDto } from "@apps/backend/common/dto/pagination-response.dto";
import { OrderResponseDto } from "@apps/backend/modules/order/dto/order-detail.dto";

/**
 * 주문 목록 조회 요청 DTO (페이지네이션)
 */
export class OrderListRequestDto extends PaginationRequestDto {
  @ApiProperty({
    description:
      "정렬. LATEST 최신순 · OLDEST 오래된순(주문일) · PRICE_DESC/PRICE_ASC 금액 · PICKUP_ASC 픽업 가까운 순 · PICKUP_DESC 픽업 최근 순(픽업 일시가 없는 주문은 맨 뒤)",
    enum: OrderSortBy,
    example: OrderSortBy.LATEST,
  })
  @IsNotEmpty()
  @IsEnum(OrderSortBy)
  sortBy: OrderSortBy;

  @ApiPropertyOptional({
    description: "(필터) 스토어 ID - 자신이 소유한 스토어의 주문만 조회",
    example: STORE_SWAGGER_EXAMPLES.ID,
  })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({
    description: "(필터) 주문 상태",
    enum: OrderStatus,
    example: OrderStatus.RESERVATION_REQUESTED,
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  orderStatus?: OrderStatus;

  @ApiPropertyOptional({
    description: "(필터) 시작 날짜 (YYYY-MM-DD 형식)",
    example: "2024-01-01",
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: "(필터) 종료 날짜 (YYYY-MM-DD 형식)",
    example: "2024-12-31",
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: "(검색) 주문 번호 (부분 일치)",
    example: "ORD-20240101-001",
  })
  @IsOptional()
  @IsString()
  orderNumber?: string;

  @ApiPropertyOptional({
    description: "(검색) 상품명 (부분 일치)",
    example: "딸기 케이크",
  })
  @IsOptional()
  @IsString()
  productName?: string;

  @ApiPropertyOptional({
    description:
      "(필터) UPCOMING 픽업 예정 · PAST 지난 예약(픽업 일시가 지났거나 끝난 주문) · FINISHED 끝난 주문(픽업완료·노쇼·취소완료·취소환불완료만)",
    enum: OrderType,
    example: OrderType.UPCOMING,
  })
  @IsOptional()
  @IsEnum(OrderType)
  type?: OrderType;

  @ApiPropertyOptional({
    description: "(필터) 픽업 예정일 시작 (YYYY-MM-DD, Asia/Seoul 달력 기준 해당일 00:00 KST 이상)",
    example: "2024-03-01",
  })
  @IsOptional()
  @IsYmdDateString()
  pickupStartDate?: string;

  @ApiPropertyOptional({
    description:
      "(필터) 픽업 예정일 종료 (YYYY-MM-DD, Asia/Seoul 달력 기준 해당일 23:59:59.999 KST 이하)",
    example: "2024-03-31",
  })
  @IsOptional()
  @IsYmdDateString()
  pickupEndDate?: string;
}

/**
 * 주문 목록 조회 응답 DTO (페이지네이션)
 */
export class OrderListResponseDto {
  @ApiProperty({
    description: "주문 목록",
    type: [OrderResponseDto],
  })
  data: OrderResponseDto[];

  @ApiProperty({
    description: "페이지네이션 메타 정보",
    type: PaginationMetaResponseDto,
  })
  meta: PaginationMetaResponseDto;
}
