import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  NAVER_IMAGE_IMPORT_MAX,
  NAVER_PRODUCT_LINK_KEY_REGEX,
} from "@apps/backend/modules/naver-place/constants/naver-booking.constants";
import { CakeSizeDisplayName } from "@apps/backend/modules/product/constants/product.constants";
import { PRODUCT_AI_DRAFT_LIMITS } from "@apps/backend/modules/product-naver/constants/product-naver.constants";

/** 가져올 수 있는 네이버 상품의 출처 */
export enum NaverProductSource {
  /** 네이버 예약 상품 (옵션까지 읽음) */
  BOOKING = "BOOKING",
  /** 네이버 플레이스 메뉴 (이름·가격·설명·사진만) */
  MENU = "MENU",
}

/** 네이버 상품 목록 1줄 */
export class NaverProductListItemDto {
  @ApiProperty({
    description: "상품을 다시 찾을 때 쓰는 값. 예약 상품은 네이버 상품 ID, 메뉴는 menu-순번",
    example: "7954953",
  })
  itemKey: string;

  @ApiProperty({ enum: NaverProductSource })
  source: NaverProductSource;

  @ApiProperty({ example: "무화과 생크림 케이크" })
  name: string;

  @ApiPropertyOptional({ nullable: true, description: "네이버 설명 앞부분" })
  summary: string | null;

  @ApiPropertyOptional({ nullable: true, description: "메뉴 가격 표시 (메뉴만)" })
  priceText: string | null;

  @ApiPropertyOptional({ nullable: true, description: "대표 사진 주소 (미리보기용)" })
  imageUrl: string | null;

  @ApiProperty({ description: "네이버에서 예약을 받지 않는 상품" })
  isClosed: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: "이미 연결한 Picake 상품 (중복으로 가져오지 않게 안내)",
  })
  linkedProduct: { id: string; name: string } | null;
}

export class NaverProductListResponseDto {
  @ApiProperty({ enum: NaverProductSource, description: "목록 출처" })
  source: NaverProductSource;

  @ApiProperty({ example: "2026-11-05T09:00:00.000Z" })
  fetchedAt: string;

  @ApiProperty({ type: [NaverProductListItemDto] })
  items: NaverProductListItemDto[];

  @ApiProperty({ type: [String] })
  warnings: string[];
}

/** 네이버 옵션 1개를 Picake에 넣는 제안 */
export class NaverProductOptionDto {
  @ApiProperty({ example: "123456" })
  optionId: string;

  @ApiPropertyOptional({ nullable: true })
  categoryName: string | null;

  @ApiProperty({ example: "무화과 생크림 케이크 1호" })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  desc: string | null;

  @ApiPropertyOptional({ nullable: true, example: 54000 })
  price: number | null;

  @ApiProperty()
  isSoldOut: boolean;

  @ApiProperty({
    enum: ["SIZE", "FLAVOR", "EXTRA", "BASE"],
    description: "제안 용도 (사이즈 / 맛 / 추가 옵션 선택지 / 이 상품의 기본 가격)",
  })
  role: "SIZE" | "FLAVOR" | "EXTRA" | "BASE";

  @ApiProperty({ description: "추가 옵션으로 넣을 때의 그룹 이름", example: "추가 선택" })
  groupName: string;

  @ApiProperty({ description: "네이버에서 필수로 고르게 한 분류인지" })
  groupRequired: boolean;

  @ApiPropertyOptional({ nullable: true, description: "옵션 사진 (미리보기용)" })
  imageUrl: string | null;

  @ApiPropertyOptional({ enum: CakeSizeDisplayName, nullable: true })
  sizeDisplayName: CakeSizeDisplayName | null;

  @ApiPropertyOptional({ nullable: true, description: "글에 적힌 지름(cm). 호수로 추정하지 않음" })
  lengthCm: number | null;

  @ApiProperty()
  selectedByDefault: boolean;

  @ApiPropertyOptional({ nullable: true })
  invalidReason: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "이 옵션을 상품 하나로 이미 가져온 Picake 상품",
  })
  linkedProduct: { id: string; name: string } | null;
}

export class NaverProductDetailResponseDto {
  @ApiProperty()
  itemKey: string;

  @ApiProperty({ enum: NaverProductSource })
  source: NaverProductSource;

  @ApiProperty()
  fetchedAt: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true, description: "네이버 상품 설명 원문" })
  description: string | null;

  @ApiPropertyOptional({ nullable: true, description: "네이버 예약 주의사항 원문" })
  precautions: string | null;

  @ApiProperty({
    type: [String],
    description: "네이버 사진 주소 (미리보기용, 가져오기는 순번으로)",
  })
  imageUrls: string[];

  @ApiProperty({ type: [NaverProductOptionDto] })
  options: NaverProductOptionDto[];

  @ApiPropertyOptional({ nullable: true, description: "판매가 후보 (사이즈 중 가장 싼 가격)" })
  suggestedSalePrice: number | null;

  @ApiProperty()
  isClosed: boolean;

  @ApiProperty({ type: [String] })
  soldOutOptionNames: string[];

  @ApiProperty({
    description:
      "여러 상품을 옵션으로 묶은 네이버 상품(포장주문 등)으로 보이면 true. 옵션을 `상품ID-o옵션ID`로 하나씩 가져오도록 안내",
  })
  menuLike: boolean;

  @ApiPropertyOptional({ nullable: true })
  linkedProduct: { id: string; name: string } | null;

  @ApiProperty({ type: [String] })
  warnings: string[];
}

/** 네이버 사진 가져오기 요청 */
export class ImportNaverImagesRequestDto {
  @ApiProperty({
    description: "가져올 사진 순번 (상품 상세 응답의 imageUrls 기준, 0부터)",
    example: [0, 1],
    type: [Number],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NAVER_IMAGE_IMPORT_MAX)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(50, { each: true })
  indexes: number[];
}

export class ImportNaverImagesResponseDto {
  @ApiProperty({ type: [String], description: "Picake에 올린 사진 주소 (고른 순서대로)" })
  urls: string[];

  @ApiProperty({ type: [Number], description: "가져오지 못한 사진 순번" })
  failedIndexes: number[];
}

/** 상품에 네이버 예약 상품 연결 요청 */
export class LinkNaverItemRequestDto {
  @ApiProperty({
    description: "네이버 예약 상품 ID (상품 안 옵션 하나는 `상품ID-o옵션ID`)",
    example: "7954953",
  })
  @IsString()
  @Matches(NAVER_PRODUCT_LINK_KEY_REGEX)
  bizItemId: string;
}

export class ProductNaverLinkResponseDto {
  @ApiProperty()
  productId: string;

  @ApiPropertyOptional({ nullable: true })
  naverBizItemId: string | null;

  @ApiPropertyOptional({ nullable: true })
  naverLinkedAt: string | null;
}

/** AI 상세설명 초안 요청 */
export class ProductDescriptionDraftRequestDto {
  @ApiProperty({ example: "무화과 생크림 케이크" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_AI_DRAFT_LIMITS.MAX_NAME_LENGTH)
  productName: string;

  @ApiPropertyOptional({ description: "네이버 상품 설명 등 참고 원문" })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_AI_DRAFT_LIMITS.MAX_SOURCE_LENGTH)
  sourceText?: string;

  @ApiPropertyOptional({
    description: "판매자가 직접 확인한 사실 (재료·크기·보관 방법·알레르기 등)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_AI_DRAFT_LIMITS.MAX_FACTS_LENGTH)
  sellerFacts?: string;

  @ApiPropertyOptional({ description: "사이즈·옵션 요약 (예: 미니 38,000원 / 1호 54,000원)" })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_AI_DRAFT_LIMITS.MAX_OPTIONS_LENGTH)
  optionSummary?: string;
}

export class ProductDescriptionDraftResponseDto {
  @ApiProperty({ description: "초안 문단 목록 (판매자가 확인해야 할 곳은 [판매자 확인 필요])" })
  paragraphs: string[];

  @ApiProperty({ type: [String], description: "판매자에게 확인을 부탁하는 질문" })
  questions: string[];

  @ApiProperty({ example: "claude-sonnet-5-5" })
  model: string;
}
