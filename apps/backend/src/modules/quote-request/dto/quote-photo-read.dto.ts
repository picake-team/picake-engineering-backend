import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import { QuoteCream } from "@apps/backend/infra/database/prisma/generated/client";
import { QUOTE_PHOTO_READ_ERROR_MESSAGES } from "@apps/backend/modules/quote-request/constants/quote-photo-read.constants";

/** 견적 요청서 참고 사진 읽기(기획 I-112 1-나) */
export class QuotePhotoReadRequestDto {
  @ApiProperty({
    description:
      "JPG·PNG 사진의 data URL(data:image/jpeg;base64,…). 웹이 1280px 안·품질 0.8로 줄여 보낸다. 풀었을 때 2.5MB까지. 저장하지 않는다",
    example: "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  })
  @IsString({ message: QUOTE_PHOTO_READ_ERROR_MESSAGES.INVALID_IMAGE })
  @IsNotEmpty({ message: QUOTE_PHOTO_READ_ERROR_MESSAGES.INVALID_IMAGE })
  image: string;
}

export class QuotePhotoReadRowDto {
  @ApiProperty({
    description: "읽은 줄 이름(모양·크림 색·테두리·장식·글자·초·토퍼·크림 종류, 이 순서)",
    example: "모양",
  })
  label: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "보이는 대로 쓴 값. 보이지 않거나 확실하지 않으면 null",
    example: "원형 1단 도시락 케이크",
  })
  value: string | null;
}

export class QuotePhotoReadPartsDto {
  @ApiProperty({ description: "모양·종류", example: "흰 크림 도시락 케이크" })
  shape: string;

  @ApiProperty({ description: "크림·바탕 색", example: "흰색" })
  color: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "테두리 파이핑과 위 장식",
    example: "분홍 하트 테두리",
  })
  decoration: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "큰따옴표 안의 글자와 색·모양",
    example: '"생일 축하해" 갈색 손글씨',
  })
  lettering: string | null;
}

/**
 * 읽은 결과. 케이크가 아니거나 읽지 못하면 `{ unreadable: true }`만 온다(나머지 칸 없음)
 */
export class QuotePhotoReadResponseDto {
  @ApiPropertyOptional({
    description: "케이크가 아니거나 읽지 못했을 때만 true(이때 다른 칸은 오지 않음)",
    example: true,
  })
  unreadable?: true;

  @ApiPropertyOptional({ type: [QuotePhotoReadRowDto], description: "읽은 줄(7줄, 순서 고정)" })
  read?: QuotePhotoReadRowDto[];

  @ApiPropertyOptional({
    type: QuotePhotoReadPartsDto,
    description: "따를 것을 고를 때 보이는 이름",
  })
  parts?: QuotePhotoReadPartsDto;

  @ApiPropertyOptional({
    description: '요청서 디자인 설명 칸에 넣을 한 문장("사진처럼"으로 시작, 180자까지)',
    example:
      '사진처럼 흰 크림 도시락 케이크에 분홍 하트 테두리를 두르고 가운데에 "생일 축하해"를 갈색으로 써 주세요.',
  })
  description?: string;

  @ApiPropertyOptional({
    enum: ["LUNCHBOX", "MINI"],
    nullable: true,
    description: "누가 봐도 도시락·미니일 때만, 그 밖에는 null(호 크기는 짐작하지 않음)",
  })
  size?: "LUNCHBOX" | "MINI" | null;

  @ApiPropertyOptional({
    enum: QuoteCream,
    isArray: true,
    description: "크림 종류가 틀림없을 때만",
  })
  creams?: QuoteCream[];

  @ApiPropertyOptional({
    description: "초·토퍼가 분명히 보일 때만(예: 사진처럼 초 1개), 아니면 빈 문자열",
    example: "",
  })
  requestNote?: string;
}
