import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { PaginationMetaResponseDto } from "@apps/backend/common/dto/pagination-response.dto";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { QUOTE_REQUEST_ERROR_MESSAGES } from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import {
  AdminQuoteRequestDetailDto,
  AdminQuoteRequestListQueryDto,
  AdminQuoteRequestListResponseDto,
} from "@apps/backend/modules/quote-request/dto/quote-request-admin.dto";
import { QuoteRequestReadService } from "@apps/backend/modules/quote-request/services/quote-request-read.service";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";
import { QuoteRequestStoreInputDto } from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import {
  AdminQuoteSectionDto,
  QuoteDeclineInputDto,
  QuoteDto,
  QuoteInputDto,
} from "@apps/backend/modules/quote-request/dto/quote.dto";

/**
 * 견적 요청 관리 컨트롤러 (관리자, 기획 I-46 SC-45·46)
 */
@ApiTags("[관리자] 견적 요청")
@ApiExtraModels(
  AdminQuoteRequestListResponseDto,
  AdminQuoteRequestDetailDto,
  PaginationMetaResponseDto,
)
@Controller(`${AUDIENCE.ADMIN}/quote-request-management`)
@Auth({ isPublic: false, audiences: [AUDIENCE.ADMIN] })
export class AdminQuoteRequestManagementController {
  constructor(
    private readonly readService: QuoteRequestReadService,
    private readonly quoteService: QuoteService,
  ) {}

  @Get("requests/:id/quotes")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 가게별 견적 상태(SC-46 ②④)",
    description:
      "물어본 가게마다 견적 링크·열어 봄·판매자 앱으로 보냄·견적/어려워요·대화 있음(내용 없이)·답 기다림. 고른 가게와 '사장님께 알리기' 상태.",
  })
  @SwaggerResponse(200, { dataDto: AdminQuoteSectionDto })
  @SwaggerAuthResponses()
  async quotes(@Param("id") id: string) {
    return await this.quoteService.adminSection(id);
  }

  @Post("requests/:id/stores")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 가게 추가(SC-46 ⑤)",
    description:
      "Picake 가게(storeId)·지도의 가게(kakaoPlaceId+이름)·이름만. Picake 가게면 판매자 앱 채팅으로 요청서가 바로 갑니다.",
  })
  @SwaggerResponse(200, { dataDto: AdminQuoteSectionDto })
  @SwaggerAuthResponses()
  async addStore(@Param("id") id: string, @Body() dto: QuoteRequestStoreInputDto) {
    return await this.quoteService.adminAddTarget(id, dto);
  }

  @Post("requests/:id/stores/:targetId/link")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 그 가게만의 견적 링크 만들기(SC-46 ⑥)" })
  @SwaggerAuthResponses()
  async link(@Param("id") id: string, @Param("targetId") targetId: string) {
    return await this.quoteService.adminCreateLink(id, targetId);
  }

  @Put("requests/:id/stores/:targetId/quote")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 대신 적기(SC-46 ⑦)",
    description:
      "사장님이 DM으로 답했을 때 운영자가 견적 링크와 같은 칸으로 적습니다. 손님에게 보여도 된다는 확인을 받았을 때만.",
  })
  @SwaggerResponse(200, { dataDto: QuoteDto })
  @SwaggerAuthResponses()
  async submit(
    @Param("id") id: string,
    @Param("targetId") targetId: string,
    @Body() dto: QuoteInputDto,
  ) {
    return await this.quoteService.adminSubmit(id, targetId, dto);
  }

  @Post("requests/:id/stores/:targetId/decline")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 대신 적기 — 어려워요" })
  @SwaggerAuthResponses()
  async decline(
    @Param("id") id: string,
    @Param("targetId") targetId: string,
    @Body() dto: QuoteDeclineInputDto,
  ) {
    await this.quoteService.adminDecline(id, targetId, dto.reason);
    return { declined: true };
  }

  @Post("requests/:id/chosen-notified")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 고른 입점 전 가게에 알렸어요(SC-46 ⑧)" })
  @SwaggerAuthResponses()
  async chosenNotified(@Param("id") id: string) {
    await this.quoteService.adminMarkChosenNotified(id);
    return { notified: true };
  }

  @Post("requests/:id/close")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 요청 마감하기(SC-46 ⑨, 장난·받을 수 없는 요청)" })
  @SwaggerAuthResponses()
  async close(@Param("id") id: string) {
    await this.quoteService.adminClose(id);
    return { closed: true };
  }

  @Get("requests")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 견적 요청 목록",
    description:
      "상태별(견적 받는 중·가게 연결·마감) 목록. 견적 받는 중은 마감이 가까운 순, 나머지는 최신 요청순입니다.",
  })
  @SwaggerResponse(200, { dataDto: AdminQuoteRequestListResponseDto })
  @SwaggerAuthResponses()
  async list(@Query() query: AdminQuoteRequestListQueryDto) {
    return await this.readService.listForAdmin(query);
  }

  @Get("requests/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 견적 요청 상세",
    description:
      "요청서 전체, 손님이 넣은 가게(연락처·카카오 장소 링크 포함), 요청한 손님을 반환합니다.",
  })
  @SwaggerResponse(200, { dataDto: AdminQuoteRequestDetailDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(404, {
    dataExample: createMessageObject(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND),
  })
  async detail(@Param("id") id: string) {
    return await this.readService.getForAdmin(id);
  }
}
