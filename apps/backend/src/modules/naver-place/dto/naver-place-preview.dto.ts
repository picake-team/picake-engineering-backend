import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

/**
 * 네이버 플레이스 미리보기 요청 DTO
 */
export class NaverPlacePreviewRequestDto {
  @ApiProperty({
    description:
      "네이버 플레이스 링크 또는 플레이스 ID. 네이버 지도 앱의 공유 링크(naver.me)도 됩니다.",
    example: "https://map.naver.com/p/entry/place/1855763938",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url: string;
}

/**
 * 스토어 폼 자동 채우기 값
 */
export class NaverPlaceStorePrefillDto {
  @ApiProperty({ example: "아네모네시 케이크 연남" })
  name: string;

  @ApiPropertyOptional({ example: "Anemonesi Cake는 2019년 설립된 …", nullable: true })
  description: string | null;

  @ApiPropertyOptional({ example: "0507-1425-1250", nullable: true })
  phoneNumber: string | null;

  @ApiPropertyOptional({
    description: "지번 주소",
    example: "서울 마포구 동교동 153-23",
    nullable: true,
  })
  address: string | null;

  @ApiPropertyOptional({ example: "서울 마포구 동교로 212-22 1층", nullable: true })
  roadAddress: string | null;

  @ApiPropertyOptional({ example: 37.5592408, nullable: true })
  latitude: number | null;

  @ApiPropertyOptional({ example: 126.9243575, nullable: true })
  longitude: number | null;

  @ApiPropertyOptional({ example: "anemonesi", nullable: true })
  instagramId: string | null;

  @ApiPropertyOptional({
    description: "정기 휴무 요일 (0=일 … 6=토)",
    example: [2, 3],
    type: [Number],
    nullable: true,
  })
  weeklyClosedWeekdays: number[] | null;

  @ApiPropertyOptional({ example: "11:00", nullable: true })
  standardOpenTime: string | null;

  @ApiPropertyOptional({ example: "19:00", nullable: true })
  standardCloseTime: string | null;
}

/**
 * 네이버 플레이스 미리보기 응답 DTO
 */
export class NaverPlacePreviewResponseDto {
  @ApiProperty({ example: "1855763938" })
  placeId: string;

  @ApiProperty({ type: NaverPlaceStorePrefillDto })
  storePrefill: NaverPlaceStorePrefillDto;

  @ApiProperty({
    description: "자동으로 채우지 못했거나 확인이 필요한 항목",
    example: [
      "영업시간이 다른 요일이 있어요: 목요일 14:00~19:00. 날짜별 예외로 따로 설정해 주세요.",
    ],
    type: [String],
  })
  warnings: string[];

  @ApiProperty({
    description:
      "네이버 플레이스에서 읽은 전체 정보 (영업시간·메뉴·사진·리뷰 통계 등). 화면 미리보기와 검증용",
    type: Object,
  })
  naverPlace: Record<string, any>;
}
