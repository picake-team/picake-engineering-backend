import { Body, Controller, HttpCode, HttpStatus, Post, Request } from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import {
  SellerTestPushResponseDto,
  SyncSellerFcmTokenBodyDto,
} from "@apps/backend/modules/fcm/dto/seller-fcm-token.dto";
import { SellerFcmTokenService } from "@apps/backend/modules/fcm/services/seller-fcm-token.service";
import { SellerFcmPushService } from "@apps/backend/modules/fcm/services/seller-fcm-push.service";

/**
 * 판매자 앱(Flutter, 기획 I-48) 푸시 토큰.
 * 앱 ↔ 웹 브릿지는 손님 앱과 같습니다: 웹이 `requestFcmTokenUpsert`를 보내면 앱이 `window.FcmToken.upsert`로
 * 토큰을 넘기고, 웹이 이 API를 부릅니다.
 */
@ApiTags("판매자 FCM 토큰")
@ApiExtraModels(SellerTestPushResponseDto)
@Controller(`${AUDIENCE.SELLER}/fcm-tokens`)
@Auth({ isPublic: false, audiences: ["seller"] })
export class SellerFcmTokenController {
  constructor(
    private readonly sellerFcmTokenService: SellerFcmTokenService,
    private readonly sellerFcmPushService: SellerFcmPushService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "(로그인 필요) 판매자 앱 FCM 디바이스 토큰 동기화 (토큰 갱신/추가, 빈 토큰 전달 시 해당 디바이스 토큰 제거)",
  })
  @SwaggerResponse(200, { dataExample: { ok: true } })
  @SwaggerAuthResponses()
  async syncFcmToken(
    @Body() body: SyncSellerFcmTokenBodyDto,
    @Request() req: { user: JwtVerifiedPayload },
  ): Promise<{ ok: true }> {
    await this.sellerFcmTokenService.syncToken(req.user.sub, body.deviceId, body.token);
    return { ok: true };
  }

  @Post("test")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary:
      "(로그인 필요) 판매자 앱 테스트 알림 보내기 — 알림이 켜진 내 기기 전부로 보냅니다. 보낸 기기 수를 돌려줍니다",
  })
  @SwaggerResponse(200, { dataDto: SellerTestPushResponseDto })
  @SwaggerAuthResponses()
  async sendTestPush(
    @Request() req: { user: JwtVerifiedPayload },
  ): Promise<SellerTestPushResponseDto> {
    return this.sellerFcmPushService.sendTestPush(req.user.sub);
  }
}
