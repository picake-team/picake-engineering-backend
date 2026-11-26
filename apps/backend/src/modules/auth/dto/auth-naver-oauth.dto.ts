import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  ValidateIf,
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
 * 네이버 로그인 요청 DTO (Authorization Code + state)
 */
export class NaverLoginRequestDto {
  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.NAVER_CODE,
    example: SWAGGER_EXAMPLES.NAVER_CODE,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(512)
  code: string;

  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.NAVER_STATE,
    example: SWAGGER_EXAMPLES.NAVER_STATE,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  state: string;
}

/**
 * 네이버 연동 회원가입 요청 DTO — 카카오와 같게 가입표의 번호로 문자 인증 없이 가입할 수 있다(useTicketPhone).
 * 네이버는 약관을 동의 화면에 넣을 수 없어 약관은 늘 가입 화면에서 받는다.
 */
export class NaverRegisterRequestDto {
  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.REGISTER_TOKEN,
    example: SWAGGER_EXAMPLES.REGISTER_TOKEN,
  })
  @IsNotEmpty()
  @IsString()
  registerToken: string;

  @ApiProperty({
    description: SWAGGER_DESCRIPTIONS.USE_TICKET_PHONE,
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  useTicketPhone?: boolean;

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
    required: false,
  })
  @ValidateIf((o) => o.useTicketPhone !== true)
  @IsString()
  @IsValidKoreanPhone()
  phone?: string;

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
