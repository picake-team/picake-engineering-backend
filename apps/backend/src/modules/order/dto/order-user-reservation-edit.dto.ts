import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { CreateOrderItemDto } from "@apps/backend/modules/order/dto/order-create.dto";
import { SWAGGER_EXAMPLES } from "@apps/backend/modules/order/constants/order.constants";

/**
 * 예약신청 단계 — 픽업 일시 변경 요청
 */
export class UpdateReservationPickupDateRequestDto {
  @ApiProperty({
    description: "변경할 픽업 날짜 및 시간 (ISO 8601)",
    example: "2024-01-15T14:00:00.000Z",
  })
  @IsNotEmpty()
  @IsDateString()
  pickupDate: string;
}

/**
 * 예약신청 단계 — 주문 항목 1개의 옵션 변경 요청
 * 항목 필드는 주문 생성 API의 items[] 한 개와 같습니다. 다른 항목은 저장된 내용·금액을 그대로 유지합니다.
 */
export class UpdateReservationOrderItemRequestDto extends CreateOrderItemDto {
  @ApiProperty({
    description:
      "변경 후 주문 총 금액 (다른 항목의 기존 금액 + 이 항목의 새 금액, 서버 계산과 일치해야 함)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.totalPrice,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  totalPrice: number;

  @ApiPropertyOptional({
    description: "구매자가 옵션을 고를 때 본 상품의 optionsVersion (다르면 409)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.productOptionsVersion,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  productOptionsVersion?: number;
}

/**
 * [레거시] 예약신청 단계 — 주문 항목(옵션 조합·수량 등) 전체 교체 요청
 * 구버전 web-user용. 항목 단건 변경 API로 대체되었고 정리 단계에서 삭제합니다.
 */
export class UpdateReservationOrderItemsRequestDto {
  @ApiProperty({
    description: "주문 항목 목록 (생성 API와 동일 스키마, 기존 항목은 삭제 후 재생성)",
    type: [CreateOrderItemDto],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiProperty({
    description: "총 수량 (항목 quantity 합과 일치해야 함)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.totalQuantity,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  totalQuantity: number;

  @ApiProperty({
    description: "총 금액 (서버 계산 금액과 일치해야 함)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.totalPrice,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  totalPrice: number;
}
