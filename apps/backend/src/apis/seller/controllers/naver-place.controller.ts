import { Controller, Get, HttpCode, HttpStatus, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import { NaverPlaceService } from "@apps/backend/modules/naver-place/naver-place.service";
import {
  NaverPlacePreviewRequestDto,
  NaverPlacePreviewResponseDto,
} from "@apps/backend/modules/naver-place/dto/naver-place-preview.dto";
import { NAVER_PLACE_ERROR_MESSAGES } from "@apps/backend/modules/naver-place/constants/naver-place.constants";

/**
 * 네이버 플레이스 연동 컨트롤러
 */
@ApiTags("네이버 플레이스")
@Controller(`${AUDIENCE.SELLER}/naver-place`)
@Auth({ isPublic: false, audiences: ["seller"] }) // 판매자 JWT(aud: seller)만 허용
export class SellerNaverPlaceController {
  constructor(private readonly naverPlaceService: NaverPlaceService) {}

  /**
   * 네이버 플레이스 미리보기 API
   * 네이버 플레이스 링크로 매장 정보를 조회해 스토어 폼 자동 채우기 값을 돌려줍니다. 저장은 하지 않습니다.
   */
  @Get("preview")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요) 네이버 플레이스 매장 정보 미리보기",
    description:
      "네이버 플레이스 링크(naver.me 공유 링크, map.naver.com 링크, 플레이스 ID)로 매장 정보를 조회합니다. \n`storePrefill`은 스토어 폼에 바로 채울 값, `warnings`는 확인이 필요한 항목, `naverPlace`는 네이버에서 읽은 전체 정보입니다. \n저장은 하지 않습니다.",
  })
  @SwaggerResponse(200, { dataDto: NaverPlacePreviewResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, {
    dataExample: createMessageObject(NAVER_PLACE_ERROR_MESSAGES.INVALID_URL),
  })
  @SwaggerResponse(404, { dataExample: createMessageObject(NAVER_PLACE_ERROR_MESSAGES.NOT_FOUND) })
  @SwaggerResponse(502, {
    dataExample: createMessageObject(NAVER_PLACE_ERROR_MESSAGES.FETCH_FAILED),
  })
  async preview(@Query() query: NaverPlacePreviewRequestDto) {
    return await this.naverPlaceService.preview(query.url);
  }
}
