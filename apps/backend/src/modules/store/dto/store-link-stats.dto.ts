import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * 링크 방문 남기기 요청 DTO (기획 I-45)
 */
export class RecordStoreLinkVisitRequestDto {
  @ApiProperty({
    description:
      "손님 기기에서 한 번 만들어 두는 임의 값(UUID). 계정·이름과 잇지 않고, 같은 기기가 여러 번 열어도 한 명으로 센다.",
    example: "3f1c2b9a-6d4e-4f8a-9b7c-1e2d3c4b5a69",
  })
  @IsUUID()
  visitorKey: string;
}

/**
 * 링크 효과 응답 DTO (기획 I-45) — 판매자 앱 "손님에게 링크 보내기" 창에 보인다
 */
export class StoreLinkStatsResponseDto {
  @ApiProperty({ description: "센 기간(일). 오늘을 포함해 최근 N일", example: 30 })
  days: number;

  @ApiProperty({
    description:
      "기간 안에 사장님이 보낸 가게·상품 링크(?from=link)로 들어온 손님 기기 수. 미리보기를 만드는 프로그램은 세지 않는다",
    example: 12,
  })
  visitorCount: number;

  @ApiProperty({
    description: "기간 안에 그 링크로 들어와 한 예약 신청 수(취소된 예약 포함)",
    example: 3,
  })
  reservationCount: number;
}
