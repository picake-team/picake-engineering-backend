import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
  Min,
  Max,
  IsInt,
  IsBoolean,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";
import {
  EnableStatus,
  ProductCategoryType,
  ProductType,
  CakeSizeDisplayName,
  CustomOptionType,
  CUSTOM_OPTION_LIMITS,
} from "@apps/backend/modules/product/constants/product.constants";
import { SWAGGER_EXAMPLES as STORE_SWAGGER_EXAMPLES } from "@apps/backend/modules/store/constants/store.constants";
import { SWAGGER_EXAMPLES as PRODUCT_SWAGGER_EXAMPLES } from "@apps/backend/modules/product/constants/product.constants";

/**
 * 케이크 사이즈 옵션 DTO (생성용 - id 선택적)
 */
export class CreateCakeSizeOptionDto {
  @ApiPropertyOptional({
    description: "옵션 고유 ID (신규 생성 시 생략 가능, 백엔드에서 자동 생성)",
    example: "size_abcd1234",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    description: "노출 여부",
    enum: EnableStatus,
    example: EnableStatus.ENABLE,
  })
  @IsNotEmpty()
  @IsEnum(EnableStatus)
  visible: EnableStatus;

  @ApiProperty({
    description: "표시명",
    enum: CakeSizeDisplayName,
    example: CakeSizeDisplayName.MINI,
  })
  @IsNotEmpty()
  @IsEnum(CakeSizeDisplayName)
  displayName: CakeSizeDisplayName;

  @ApiProperty({
    description: "케이크 지름/길이 (cm 단위, 숫자만)",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.cakeSizeOptions[0].lengthCm,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  lengthCm: number;

  @ApiProperty({
    description: "해당 사이즈의 가격",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.cakeSizeOptions[0].price,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    description: "설명",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.cakeSizeOptions[0].description,
  })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * 케이크 맛 옵션 DTO (생성용 - id 선택적)
 */
export class CreateCakeFlavorOptionDto {
  @ApiPropertyOptional({
    description: "옵션 고유 ID (신규 생성 시 생략 가능, 백엔드에서 자동 생성)",
    example: "flavor_efgh5678",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    description: "노출 여부",
    enum: EnableStatus,
    example: EnableStatus.ENABLE,
  })
  @IsNotEmpty()
  @IsEnum(EnableStatus)
  visible: EnableStatus;

  @ApiProperty({
    description: "표시명",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.cakeFlavorOptions[0].displayName,
  })
  @IsNotEmpty()
  @IsString()
  displayName: string;

  @ApiProperty({
    description: "해당 맛 옵션의 추가 가격",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.cakeFlavorOptions[0].price,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;
}

/**
 * 추가 옵션 선택지 DTO (선택형·다중선택형)
 */
export class CustomOptionChoiceDto {
  @ApiPropertyOptional({
    description: "선택지 ID (신규 생성 시 생략, 수정 시 기존 ID 그대로 전달)",
    example: "choice_ab12cd34ef56",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ description: "옵션값 (선택지 이름)", example: "큰초" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(CUSTOM_OPTION_LIMITS.MAX_CHOICE_LABEL_LENGTH)
  label: string;

  @ApiProperty({ description: "옵션가 (추가 금액, 0 이상)", example: 1000 })
  @IsInt()
  @Min(0)
  @Max(CUSTOM_OPTION_LIMITS.MAX_CHOICE_PRICE)
  price: number;

  @ApiProperty({ description: "노출 여부", enum: EnableStatus, example: EnableStatus.ENABLE })
  @IsEnum(EnableStatus)
  visible: EnableStatus;
}

/**
 * 추가 옵션 DTO
 * 형식별 필수 값(choices·maxLength·maxCount)과 조합 규칙은 서비스에서 검증합니다.
 */
export class CustomOptionDto {
  @ApiPropertyOptional({
    description: "옵션 ID (신규 생성 시 생략, 수정 시 기존 ID 그대로 전달)",
    example: "opt_ab12cd34ef56",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    description:
      "옵션 형식 - SINGLE_SELECT(선택형), MULTI_SELECT(다중선택형), TEXT(직접입력형), IMAGE(사진첨부형)",
    enum: CustomOptionType,
    example: CustomOptionType.SINGLE_SELECT,
  })
  @IsEnum(CustomOptionType)
  type: CustomOptionType;

  @ApiProperty({ description: "옵션명", example: "초 추가" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(CUSTOM_OPTION_LIMITS.MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({ description: "필수 여부", example: false })
  @IsBoolean()
  required: boolean;

  @ApiProperty({ description: "노출 여부", enum: EnableStatus, example: EnableStatus.ENABLE })
  @IsEnum(EnableStatus)
  visible: EnableStatus;

  @ApiPropertyOptional({
    description: "선택지 목록 (선택형·다중선택형 필수)",
    type: [CustomOptionChoiceDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOM_OPTION_LIMITS.MAX_CHOICES)
  @ValidateNested({ each: true })
  @Type(() => CustomOptionChoiceDto)
  choices?: CustomOptionChoiceDto[];

  @ApiPropertyOptional({
    description: "최대 선택 개수 (다중선택형, 생략 시 제한 없음)",
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxSelect?: number;

  @ApiPropertyOptional({ description: "최대 글자 수 (직접입력형 필수)", example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CUSTOM_OPTION_LIMITS.MAX_TEXT_LENGTH)
  maxLength?: number;

  @ApiPropertyOptional({
    description: "입력 안내 문구 (직접입력형)",
    example: "케이크에 들어갈 문구를 적어주세요.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_OPTION_LIMITS.MAX_PLACEHOLDER_LENGTH)
  placeholder?: string;

  @ApiPropertyOptional({ description: "최대 사진 수 (사진첨부형 필수)", example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CUSTOM_OPTION_LIMITS.MAX_IMAGE_COUNT)
  maxCount?: number;
}

/**
 * 상품 등록 요청 DTO
 */
export class CreateProductRequestDto {
  @ApiProperty({
    description: "스토어 ID",
    example: STORE_SWAGGER_EXAMPLES.ID,
  })
  @IsNotEmpty()
  @IsString()
  storeId: string;

  @ApiProperty({
    description: "상품명",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.name,
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    description: "이미지 URL 목록 (첫 번째 요소가 대표 이미지, 필수)",
    isArray: true,
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.images,
  })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  images: string[];

  @ApiProperty({
    description: "정가",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.originalPrice,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  originalPrice: number;

  @ApiProperty({
    description: "판매가",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.salePrice,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  salePrice: number;

  @ApiProperty({
    description: "판매여부",
    enum: EnableStatus,
    example: EnableStatus.ENABLE,
  })
  @IsNotEmpty()
  @IsEnum(EnableStatus)
  salesStatus: EnableStatus;

  @ApiProperty({
    description: "노출여부",
    enum: EnableStatus,
    example: EnableStatus.ENABLE,
  })
  @IsNotEmpty()
  @IsEnum(EnableStatus)
  visibilityStatus: EnableStatus;

  @ApiProperty({
    description:
      "상품 유형 (스토어 상세 기본/커스텀 탭 분류). 추가 옵션 구성과 무관하게 판매자가 선택",
    enum: ProductType,
    example: ProductType.CUSTOM_CAKE,
  })
  @IsEnum(ProductType)
  productType: ProductType;

  @ApiProperty({
    description: "케이크 옵션 - 사이즈 목록 (노출 중인 사이즈 1개 이상 필수)",
    type: [CreateCakeSizeOptionDto],
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.cakeSizeOptions,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCakeSizeOptionDto)
  cakeSizeOptions: CreateCakeSizeOptionDto[];

  @ApiProperty({
    description: "케이크 옵션 - 맛 목록 (노출 중인 맛 1개 이상 필수)",
    type: [CreateCakeFlavorOptionDto],
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.cakeFlavorOptions,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCakeFlavorOptionDto)
  cakeFlavorOptions: CreateCakeFlavorOptionDto[];

  @ApiPropertyOptional({
    description: "추가 옵션 목록 (배열 순서가 구매자 화면 노출 순서). 생략 시 없음",
    type: [CustomOptionDto],
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.customOptions,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOM_OPTION_LIMITS.MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => CustomOptionDto)
  customOptions?: CustomOptionDto[];

  @ApiPropertyOptional({
    description: "상세 설명 (HTML)",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.detailDescription,
  })
  @IsOptional()
  @IsString()
  detailDescription?: string;

  @ApiPropertyOptional({
    description:
      "상품 카테고리 타입 (없거나 여러 개) - 생일, 연인, 친구, 가족, 기념일, 당일픽업, 캐릭터, 심플, 꽃, 사진. 커스텀(LETTERING)은 상품 유형에 따라 서버가 자동으로 넣고 뺍니다",
    enum: ProductCategoryType,
    isArray: true,
    example: [ProductCategoryType.BIRTHDAY, ProductCategoryType.SIMPLE],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ProductCategoryType, { each: true })
  productCategoryTypes?: ProductCategoryType[];

  @ApiPropertyOptional({
    description: "검색 태그 (없거나 여러 개) - 검색어로 상품 조회 시 상품명과 함께 검색됨",
    type: [String],
    example: ["생일케이크", "초콜릿", "당일배송"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchTags?: string[];

  @ApiProperty({
    description: "식품의 유형",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeFoodType,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeFoodType: string;

  @ApiProperty({
    description: "제조사",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeProducer,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeProducer: string;

  @ApiProperty({
    description: "원산지",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeOrigin,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeOrigin: string;

  @ApiProperty({
    description: "소재지",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeAddress,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeAddress: string;

  @ApiProperty({
    description: "제조연월일",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeManufactureDate,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeManufactureDate: string;

  @ApiProperty({
    description: "소비기한 또는 품질유지기한",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeExpirationDate,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeExpirationDate: string;

  @ApiProperty({
    description: "포장단위별 용량/수량",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticePackageCapacity,
  })
  @IsNotEmpty()
  @IsString()
  productNoticePackageCapacity: string;

  @ApiProperty({
    description: "포장 단위별 수량",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticePackageQuantity,
  })
  @IsNotEmpty()
  @IsString()
  productNoticePackageQuantity: string;

  @ApiProperty({
    description: "원재료명 및 함량",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeIngredients,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeIngredients: string;

  @ApiProperty({
    description: "영양성분",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeCalories,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeCalories: string;

  @ApiProperty({
    description: "소비자안전을 위한 주의사항",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeSafetyNotice,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeSafetyNotice: string;

  @ApiProperty({
    description: "유전자변형식품에 해당하는 경우의 표시",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeGmoNotice,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeGmoNotice: string;

  @ApiProperty({
    description: "수입식품의 경우",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeImportNotice,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeImportNotice: string;

  @ApiProperty({
    description: "고객센터",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.productNoticeCustomerService,
  })
  @IsNotEmpty()
  @IsString()
  productNoticeCustomerService: string;
}

/**
 * 상품 생성 응답 DTO
 */
export class CreateProductResponseDto {
  @ApiProperty({
    description: "상품 ID",
    example: PRODUCT_SWAGGER_EXAMPLES.PRODUCT_DATA.id,
  })
  id: string;
}
