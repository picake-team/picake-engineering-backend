import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, Length, Matches } from "class-validator";
import { ACT_AS_LIMITS } from "@apps/backend/modules/act-as/constants/act-as.constants";

/** 관리자: 이 가게로 들어가기 */
export class StartActAsSessionRequestDto {
  @ApiProperty({
    description: `들어가는 까닭(${ACT_AS_LIMITS.REASON_MIN}~${ACT_AS_LIMITS.REASON_MAX}자, 기록에 남음)`,
    example: "카톡 채널 요청 — 첫 상품 3개",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(ACT_AS_LIMITS.REASON_MIN, ACT_AS_LIMITS.REASON_MAX, {
    message: "사유를 2자 이상 적어 주세요.",
  })
  reason!: string;

  @ApiProperty({
    description: "관리자 Google OTP 6자리(들어갈 때마다 다시 받음)",
    example: "123456",
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: "OTP 6자리를 넣어 주세요." })
  totpCode!: string;
}

export class StartActAsSessionResponseDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty({
    description:
      "판매자 화면 들어오기 주소(한 번만 쓰는 코드 포함, 60초 안에 열어야 함). 새 탭으로 연다",
    example: "https://seller.picakes.com/act-as?code=...",
  })
  sellerUrl!: string;
  @ApiProperty({ description: "세션이 끝나는 시각(60분 뒤)" }) expiresAt!: Date;
}

export class ActAsActionSummaryDto {
  @ApiProperty({ description: "상품 쓰기(등록·수정·네이버·AI·사진) 성공 수" }) product!: number;
  @ApiProperty({ description: "직접 적은 주문 쓰기 성공 수" }) manualOrder!: number;
  @ApiProperty({ description: "영업 캘린더 저장 성공 수" }) calendar!: number;
  @ApiProperty({ description: "스토어 정보·네이버 매장 쓰기 성공 수" }) store!: number;
  @ApiProperty({ description: "본 화면(GET) 수" }) view!: number;
  @ApiProperty({ description: "막힌 요청 수(허용 목록 밖·계좌 바꾸기 등)" }) blocked!: number;
}

export class ActAsSessionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() adminUsername!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() startedAt!: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty({ type: Date, nullable: true }) endedAt!: Date | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '"self"(판매자 화면 끝내기) | "admin:<id>" | null',
  })
  endedBy!: string | null;
  @ApiProperty({ enum: ["ACTIVE", "ENDED", "EXPIRED"] }) status!: "ACTIVE" | "ENDED" | "EXPIRED";
  @ApiProperty({ type: ActAsActionSummaryDto }) summary!: ActAsActionSummaryDto;
}

export class ActAsSessionListResponseDto {
  @ApiProperty({ type: [ActAsSessionItemDto], description: "최근 50개, 최신 순" })
  data!: ActAsSessionItemDto[];
}

export class ActAsActionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "PUT" }) method!: string;
  @ApiProperty({ example: "/seller/products/:id" }) route!: string;
  @ApiProperty({ type: String, nullable: true }) targetId!: string | null;
  @ApiProperty({ type: [String], description: "보낸 칸 이름(값 없음)" }) fields!: string[];
  @ApiProperty({ example: 200 }) status!: number;
  @ApiProperty() createdAt!: Date;
}

export class ActAsActionListResponseDto {
  @ApiProperty({ type: [ActAsActionItemDto], description: "시간 순, 500개까지" })
  data!: ActAsActionItemDto[];
}

/** 판매자 화면: 한 번만 쓰는 코드를 대리 출입증으로 바꾸기 */
export class ExchangeActAsCodeRequestDto {
  @ApiProperty({ description: "관리자 화면이 연 주소의 code" })
  @IsString()
  @Length(20, 100)
  code!: string;
}

export class ExchangeActAsCodeResponseDto {
  @ApiProperty({ description: "대리 출입증(세션이 끝나는 시각까지). 브라우저 탭 저장소에만 둔다" })
  accessToken!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty() expiresAt!: Date;
}

/** 판매자 화면 위 띠 */
export class ActAsMeResponseDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() expiresAt!: Date;
}
