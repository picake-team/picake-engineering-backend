import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import { NAVER_PLACE_ID_REGEX } from "@apps/backend/modules/naver-place/utils/naver-place-url.util";

/**
 * 네이버 플레이스 미리보기 요청 DTO
 */
export class NaverPlacePreviewRequestDto {
  @ApiProperty({
    description:
      "네이버 플레이스 링크 또는 플레이스 ID. 네이버 지도 앱의 공유 링크(naver.me)도 됩니다.",
    example: "https://map.naver.com/p/entry/place/1234567890",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url: string;
}

/**
 * 스토어 폼에 채울 수 있는 값
 */
export class NaverPlaceStorePrefillDto {
  @ApiProperty({ example: "피케이크 샘플 공방" })
  name: string;

  @ApiPropertyOptional({ example: "주문 제작 레터링 케이크 공방입니다.", nullable: true })
  description: string | null;

  @ApiPropertyOptional({ example: "0507-1234-5678", nullable: true })
  phoneNumber: string | null;

  @ApiPropertyOptional({ example: "picake_sample", nullable: true })
  instagramId: string | null;

  @ApiPropertyOptional({
    description: "지번 주소 (참고용. 실제 주소는 주소 검색으로 확정)",
    example: "서울 마포구 샘플동 1-1",
    nullable: true,
  })
  address: string | null;

  @ApiPropertyOptional({
    description: "도로명 주소 (참고용. 실제 주소는 주소 검색으로 확정)",
    example: "서울 마포구 샘플로 1 1층",
    nullable: true,
  })
  roadAddress: string | null;

  @ApiPropertyOptional({ example: 37.55, nullable: true })
  latitude: number | null;

  @ApiPropertyOptional({ example: 126.9, nullable: true })
  longitude: number | null;
}

/**
 * 쉬는 시간
 */
export class NaverPlaceBreakHoursDto {
  @ApiProperty({ example: "15:00" })
  start: string;

  @ApiProperty({ example: "16:00" })
  end: string;
}

/**
 * 네이버에 적힌 요일별 영업시간
 */
export class NaverPlaceBusinessDayDto {
  @ApiProperty({ description: "요일 (월, 화, … 또는 매일, 평일, 주말)", example: "월" })
  day: string;

  @ApiPropertyOptional({ example: "11:00", nullable: true })
  open: string | null;

  @ApiPropertyOptional({ example: "19:00", nullable: true })
  close: string | null;

  @ApiProperty({ description: "다음 날 새벽까지 영업", example: false })
  endsNextDay: boolean;

  @ApiProperty({ type: [NaverPlaceBreakHoursDto] })
  breakHours: NaverPlaceBreakHoursDto[];

  @ApiPropertyOptional({ example: "매주 화요일 정기휴무", nullable: true })
  description: string | null;
}

/**
 * 네이버 영업시간 (참고용)
 */
export class NaverPlaceBusinessHoursDto {
  @ApiProperty({ type: [NaverPlaceBusinessDayDto] })
  days: NaverPlaceBusinessDayDto[];

  @ApiPropertyOptional({
    description: "네이버에 따로 적힌 영업시간 안내",
    example: "모든 케이크는 사전예약제로 운영합니다",
    nullable: true,
  })
  freeText: string | null;
}

/**
 * 네이버 플레이스 미리보기 응답 DTO
 */
export class NaverPlacePreviewResponseDto {
  @ApiProperty({ example: "1234567890" })
  placeId: string;

  @ApiProperty({ example: "https://map.naver.com/p/entry/place/1234567890" })
  placeUrl: string;

  @ApiPropertyOptional({ example: "카페,디저트", nullable: true })
  category: string | null;

  @ApiProperty({
    description: "네이버에서 정보를 읽은 시각 (같은 매장은 10분 동안 다시 읽지 않습니다)",
    example: "2026-11-04T09:00:00.000Z",
  })
  fetchedAt: string;

  @ApiProperty({ type: NaverPlaceStorePrefillDto })
  storePrefill: NaverPlaceStorePrefillDto;

  @ApiProperty({
    description:
      "네이버 영업시간. 픽업 가능 시간과 다를 수 있어 자동으로 채우지 않고 참고로만 보여 줍니다.",
    type: NaverPlaceBusinessHoursDto,
  })
  businessHours: NaverPlaceBusinessHoursDto;

  @ApiProperty({
    description: "그대로 쓸 수 없거나 확인이 필요한 항목",
    example: ["네이버 안심번호(0507)예요. 실제 연락처로 바꾸는 걸 권장해요."],
    type: [String],
  })
  warnings: string[];
}

/**
 * 스토어에 네이버 플레이스 연결 요청 DTO
 */
export class ConnectNaverPlaceRequestDto {
  @ApiProperty({
    description: "미리보기에서 받은 네이버 플레이스 ID",
    example: "1234567890",
  })
  @IsString()
  @Matches(NAVER_PLACE_ID_REGEX, { message: "네이버 플레이스 ID 형식이 아닙니다." })
  placeId: string;
}
