import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Request } from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import {
  QuoteDeclineInputDto,
  QuoteDto,
  QuoteInputDto,
  QuoteRequestForShopDto,
} from "@apps/backend/modules/quote-request/dto/quote.dto";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";

/**
 * 판매자 앱 견적(기획 I-46 ②, 운영자 결정 2026-11-12 A안): 채팅방 맨 위 요청서 카드에서 견적을 보낸다.
 * 손님이 이 가게를 지정했거나 운영자가 이 가게에 보낸 요청만 보인다.
 */
@ApiTags("[판매자] 견적")
@ApiExtraModels(QuoteRequestForShopDto, QuoteDto)
@Controller(`${AUDIENCE.SELLER}/stores/:storeId/quote-requests/:requestId`)
@Auth({ isPublic: false, audiences: ["seller"] })
export class SellerQuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 손님 견적 요청서",
    description:
      "요청서(손님 이름·연락처 없이, 지역은 동네까지), 이 가게 쪽 상태, 보낸 견적, 주문 받는 곳 미리 채움.",
  })
  @SwaggerResponse(200, { dataDto: QuoteRequestForShopDto })
  @SwaggerAuthResponses()
  async view(
    @Param("storeId") storeId: string,
    @Param("requestId") requestId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.quoteService.sellerView(req.user.sub, storeId, requestId);
  }

  @Post("quote")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요) 견적 보내기·고치기",
    description:
      "견적 링크와 같은 칸. 손님이 고르기 전까지 고칠 수 있습니다. 보내면 채팅에 견적 카드가 들어갑니다.",
  })
  @SwaggerResponse(200, { dataDto: QuoteDto })
  @SwaggerAuthResponses()
  async submit(
    @Param("storeId") storeId: string,
    @Param("requestId") requestId: string,
    @Body() dto: QuoteInputDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.quoteService.sellerSubmit(req.user.sub, storeId, requestId, dto);
  }

  @Post("decline")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 어려워요" })
  @SwaggerAuthResponses()
  async decline(
    @Param("storeId") storeId: string,
    @Param("requestId") requestId: string,
    @Body() dto: QuoteDeclineInputDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.quoteService.sellerDecline(req.user.sub, storeId, requestId, dto.reason);
    return { declined: true };
  }
}
