import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsArray,
  MinLength,
  MaxLength,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsValidKoreanPhone } from "@apps/backend/common/decorators/validators.decorator";
import {
  SWAGGER_EXAMPLES,
  SWAGGER_DESCRIPTIONS,
} from "@apps/backend/modules/auth/constants/auth.constants";

/**
 * 구글 로그인 요청 DTO (Authorization Code)
 */
export class GoogleLoginRequestDto {
  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.GOOGLE_CODE,
    example: SWAGGER_EXAMPLES.GOOGLE_CODE,
  })
  @IsNotEmpty()
  @IsString()
  code: string;
}

/**
 * 구글 연동 회원가입 요청 DTO
 */
export class GoogleRegisterRequestDto {
  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.REGISTER_TOKEN,
    example: SWAGGER_EXAMPLES.REGISTER_TOKEN,
  })
  @IsNotEmpty()
  @IsString()
  registerToken: string;

  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.DISPLAY_NAME,
    example: SWAGGER_EXAMPLES.CONSUMER_DATA.name,
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.PHONE,
    example: SWAGGER_EXAMPLES.CONSUMER_DATA.phone,
  })
  @IsString()
  @IsValidKoreanPhone()
  phone: string;

  @ApiProperty({ description: "서비스 이용약관 동의 여부 (필수)", example: true })
  @IsBoolean()
  agreedToTerms: boolean;

  @ApiProperty({ description: "개인정보 처리방침 동의 여부 (필수)", example: true })
  @IsBoolean()
  agreedToPrivacy: boolean;

  @ApiProperty({
    description: "개인정보 제3자 제공 동의 여부 (구매자 필수, 판매자 미사용)",
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  agreedToThirdParty?: boolean;

  @ApiProperty({
    description:
      "만 14세 이상 확인 (약관 제5조, 법무 LG-02). 1단계(2026-11-26): 보내면 가입 시각을 기록하고 없어도 막지 않는다 — 웹이 다 나간 뒤 필수로",
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  agreedToAge14?: boolean;

  @ApiProperty({
    description: "위치기반서비스 이용약관 동의 여부 (구매자 선택, 판매자 미사용)",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  agreedToLocationTerms?: boolean;

  @ApiProperty({
    description: "동의한 약관 문서 ID 목록 (버전 이력 기록용, 선택)",
    example: ["clxxxxxx", "clyyyyyy"],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  termsDocumentIds?: string[];
}
