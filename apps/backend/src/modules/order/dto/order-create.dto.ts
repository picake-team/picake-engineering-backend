import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  IsOptional,
  IsDateString,
  Min,
  MaxLength,
  ArrayMaxSize,
  IsInt,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { SWAGGER_EXAMPLES } from "@apps/backend/modules/order/constants/order.constants";
import { CUSTOM_OPTION_LIMITS } from "@apps/backend/modules/product/constants/product.constants";
import { PickupAddressDto } from "@apps/backend/modules/product/dto/product-common.dto";
import { IsValidStoreName } from "@apps/backend/modules/store/decorators/validators.decorator";
import { IsValidKoreanPhone } from "@apps/backend/common/decorators/validators.decorator";

/**
 * 주문 항목의 추가 옵션 선택값
 * 옵션명·가격은 보내지 않습니다. 서버가 상품의 현재 옵션 기준으로 검증하고 스냅샷을 만듭니다.
 */
export class OrderItemOptionInputDto {
  @ApiProperty({ description: "추가 옵션 ID", example: "opt_candle01" })
  @IsNotEmpty()
  @IsString()
  optionId: string;

  @ApiPropertyOptional({
    description: "선택한 옵션값 ID 목록 (선택형은 1개, 다중선택형은 1개 이상)",
    type: [String],
    example: ["choice_candle_big"],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOM_OPTION_LIMITS.MAX_CHOICES)
  @IsString({ each: true })
  choiceIds?: string[];

  @ApiPropertyOptional({ description: "입력한 글자 (직접입력형)", example: "생일 축하해" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional({
    description: "첨부한 사진 URL 목록 (사진첨부형, 업로드 API로 받은 URL)",
    type: [String],
    example: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOM_OPTION_LIMITS.MAX_IMAGE_COUNT)
  @IsString({ each: true })
  imageUrls?: string[];
}

/**
 * 주문 항목 생성 요청 DTO
 */
export class CreateOrderItemDto {
  // 사이즈 옵션 정보 (옵션이 없는 상품의 경우 생략 가능)
  @ApiPropertyOptional({
    description: "선택한 사이즈 옵션 ID (사이즈 옵션이 없는 상품의 경우 생략)",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.sizeId,
  })
  @IsOptional()
  @IsString()
  sizeId?: string;

  @ApiPropertyOptional({
    description: "선택한 사이즈 표시명 (사이즈 옵션이 없는 상품의 경우 생략)",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.sizeDisplayName,
  })
  @IsOptional()
  @IsString()
  sizeDisplayName?: string;

  @ApiPropertyOptional({
    description: "선택한 사이즈 길이 (cm 단위, 사이즈 옵션이 없는 상품의 경우 생략)",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.sizeLengthCm,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeLengthCm?: number;

  @ApiPropertyOptional({
    description: "선택한 사이즈 설명",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.sizeDescription,
  })
  @IsOptional()
  @IsString()
  sizeDescription?: string;

  @ApiPropertyOptional({
    description: "사이즈 추가 가격 (사이즈 옵션이 없으면 0 또는 생략)",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.sizePrice,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sizePrice?: number;

  // 맛 옵션 정보 (옵션이 없는 상품의 경우 생략 가능)
  @ApiPropertyOptional({
    description: "선택한 맛 옵션 ID (맛 옵션이 없는 상품의 경우 생략)",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.flavorId,
  })
  @IsOptional()
  @IsString()
  flavorId?: string;

  @ApiPropertyOptional({
    description: "선택한 맛 표시명 (맛 옵션이 없는 상품의 경우 생략)",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.flavorDisplayName,
  })
  @IsOptional()
  @IsString()
  flavorDisplayName?: string;

  @ApiPropertyOptional({
    description: "맛 추가 가격 (맛 옵션이 없으면 0 또는 생략)",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.flavorPrice,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  flavorPrice?: number;

  @ApiPropertyOptional({
    description: "추가 옵션 선택값 목록 (옵션 ID 기준, 한 옵션당 1개)",
    type: [OrderItemOptionInputDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOM_OPTION_LIMITS.MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => OrderItemOptionInputDto)
  options?: OrderItemOptionInputDto[];

  @ApiPropertyOptional({
    description:
      "[레거시] 레터링 메시지 (최대 500자). options를 보내지 않은 구버전 요청만 상품의 첫 직접입력형 옵션으로 변환",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.letteringMessage,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  letteringMessage?: string;

  @ApiPropertyOptional({
    description: "요청 사항",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.requestMessage,
  })
  @IsOptional()
  @IsString()
  requestMessage?: string;

  @ApiProperty({
    description: "수량",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.quantity,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description:
      "[레거시] 업로드한 이미지 URL 목록. options를 보내지 않은 구버전 요청만 상품의 사진첨부형 옵션으로 변환",
    example: SWAGGER_EXAMPLES.ORDER_ITEM.imageUrls,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}

/**
 * 주문 생성 요청 DTO
 *
 * 하나의 주문은 하나의 상품(productId)에 대한 주문이지만,
 * 여러 개의 주문 항목(items)을 가질 수 있습니다.
 * 각 주문 항목은 서로 다른 옵션 조합(사이즈, 맛 등)을 가질 수 있습니다.
 * 픽업 날짜는 주문 전체에 대해 하나로 고정됩니다.
 *
 * 주문 시점의 상품 정보(상품명, 상품 이미지)는 클라이언트에서 전달받아 저장됩니다.
 * 이는 상품 정보가 변경되어도 주문 시점의 정보를 보존하기 위함입니다.
 *
 */
export class CreateOrderRequestDto extends PickupAddressDto {
  @ApiProperty({
    description: "픽업 날짜 및 시간 (ISO 8601 형식, 필수)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.pickupDate,
  })
  @IsNotEmpty()
  @IsDateString()
  pickupDate: string;

  @ApiProperty({
    description: "상품 ID (하나의 주문은 하나의 상품에 대한 주문)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.productId,
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiProperty({
    description: "상품명 (주문 시점의 상품명 보존)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.productName,
  })
  @IsNotEmpty()
  @IsString()
  productName: string;

  @ApiProperty({
    description: "상품 이미지 URL 목록 (주문 시점의 상품 이미지 보존)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.productImages,
    type: [String],
  })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  productImages: string[];

  @ApiProperty({
    description: "총 수량",
    example: SWAGGER_EXAMPLES.ORDER_DATA.totalQuantity,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  totalQuantity: number;

  @ApiProperty({
    description: "총 금액",
    example: SWAGGER_EXAMPLES.ORDER_DATA.totalPrice,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  totalPrice: number;

  @ApiPropertyOptional({
    description:
      "구매자가 옵션을 고를 때 본 상품의 optionsVersion. 현재 값과 다르면 409로 거절 (생략 시 확인하지 않음 — 구버전 클라이언트 호환)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.productOptionsVersion,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  productOptionsVersion?: number;

  @ApiProperty({
    description: "스토어명 (주문 시점의 스토어명 보존)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.storeName,
  })
  @IsValidStoreName()
  storeName: string;

  @ApiPropertyOptional({
    description: "예약자명 (선택)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.reservationContactName,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const t = value.trim();
    return t === "" ? undefined : t;
  })
  @IsString()
  @MaxLength(50)
  reservationContactName?: string;

  @ApiPropertyOptional({
    description: "예약 연락처 휴대폰 번호 (선택, 하이픈 포함 가능)",
    example: SWAGGER_EXAMPLES.ORDER_DATA.reservationPhone,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const t = value.replace(/[-\s]/g, "").trim();
    return t === "" ? undefined : t;
  })
  @IsString()
  @IsValidKoreanPhone()
  reservationPhone?: string;

  // 픽업장소 정보는 PickupAddressDto 상속

  @ApiProperty({
    description: "주문 항목 목록 (같은 상품의 여러 옵션 조합을 포함할 수 있음)",
    type: [CreateOrderItemDto],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}

/**
 * 주문 생성 응답 DTO
 * 주문 생성 시 주문 ID만 반환합니다.
 */
export class CreateOrderResponseDto {
  @ApiProperty({
    description: "주문 ID",
    example: SWAGGER_EXAMPLES.ORDER_DATA.id,
  })
  id: string;
}
