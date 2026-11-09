import { Controller, Get, HttpCode, HttpStatus, Param, Query } from "@nestjs/common";
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
  constructor(private readonly readService: QuoteRequestReadService) {}

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
