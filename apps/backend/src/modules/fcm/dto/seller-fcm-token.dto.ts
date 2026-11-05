import { ApiProperty } from "@nestjs/swagger";
import { SyncConsumerFcmTokenBodyDto } from "@apps/backend/modules/fcm/dto/consumer-fcm-token.dto";

/** 판매자 앱 FCM 토큰 동기화. 형식은 구매자와 같습니다 (빈 token이면 그 기기 토큰 삭제). */
export class SyncSellerFcmTokenBodyDto extends SyncConsumerFcmTokenBodyDto {}

export class SellerTestPushResponseDto {
  @ApiProperty({
    description: "테스트 알림을 보낸 기기 수. 0이면 앱에서 알림을 켠 기기가 없습니다.",
    example: 1,
  })
  deviceCount: number;
}
