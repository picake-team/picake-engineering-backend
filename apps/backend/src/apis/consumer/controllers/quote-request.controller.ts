import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
} from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import {
  QUOTE_REQUEST_ERROR_MESSAGES,
  QUOTE_REQUEST_SUCCESS_MESSAGES,
} from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import {
  CreateQuoteRequestDto,
  CreateQuoteRequestResponseDto,
  QuoteRequestDetailDto,
  QuoteRequestListQueryDto,
  QuoteRequestListResponseDto,
} from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import { QuoteRequestReadService } from "@apps/backend/modules/quote-request/services/quote-request-read.service";
import { QuoteRequestWriteService } from "@apps/backend/modules/quote-request/services/quote-request-write.service";

/**
 * 견적 요청 컨트롤러 (손님용, 기획 I-46)
 * 손님이 원하는 케이크를 요청서로 보내고, 내 견적 요청을 본다.
 */
@ApiTags("견적 요청")
@ApiExtraModels(CreateQuoteRequestResponseDto, QuoteRequestListResponseDto, QuoteRequestDetailDto)
@Controller(`${AUDIENCE.CONSUMER}/quote-requests`)
@Auth({ isPublic: false, audiences: ["consumer"] })
export class ConsumerQuoteRequestController {
  constructor(
    private readonly readService: QuoteRequestReadService,
    private readonly writeService: QuoteRequestWriteService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "(로그인 필요) 견적 요청서 보내기",
    description:
      "픽업 날짜·시간, 받을 동네와 거리(또는 '이 가게에만'), 물어볼 가게(5곳까지), 참고 사진·설명(둘 중 하나), 크기·개수·크림·예산, 요청 사항을 저장합니다(가게 전달 동의 칸은 2026-11-10에 없앰). " +
      "견적 마감은 픽업 시작 1시간 전이고, 지금부터 3시간 안의 시각은 고를 수 없습니다. 저장되면 운영자에게 디스코드 알림이 갑니다.",
  })
  @SwaggerResponse(201, { dataDto: CreateQuoteRequestResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, { dataExample: createMessageObject(QUOTE_REQUEST_ERROR_MESSAGES.TOO_SOON) })
  @SwaggerResponse(409, {
    dataExample: createMessageObject(QUOTE_REQUEST_ERROR_MESSAGES.TOO_MANY_OPEN),
  })
  async create(@Body() dto: CreateQuoteRequestDto, @Request() req: { user: JwtVerifiedPayload }) {
    return await this.writeService.createForConsumer(req.user.sub, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 내 견적 요청 목록",
    description:
      "진행 중(마감 전, 픽업이 가까운 순) / 지난 요청(최근 픽업 순)과 탭별 개수를 반환합니다.",
  })
  @SwaggerResponse(200, { dataDto: QuoteRequestListResponseDto })
  @SwaggerAuthResponses()
  async list(
    @Query() query: QuoteRequestListQueryDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.readService.listForConsumer(req.user.sub, query);
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 내 견적 요청 상세",
    description:
      "보낸 요청서 전체(사진 포함)와 넣은 가게를 반환합니다. 다른 손님의 요청은 찾을 수 없음(404)입니다.",
  })
  @SwaggerResponse(200, { dataDto: QuoteRequestDetailDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(404, {
    dataExample: createMessageObject(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND),
  })
  async detail(@Param("id") id: string, @Request() req: { user: JwtVerifiedPayload }) {
    return await this.readService.getForConsumer(req.user.sub, id);
  }

  @Post(":id/close")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 견적 요청 닫기",
    description: "견적 받는 중인 요청을 닫습니다. 되돌릴 수 없습니다.",
  })
  @SwaggerResponse(200, { dataExample: createMessageObject(QUOTE_REQUEST_SUCCESS_MESSAGES.CLOSED) })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, { dataExample: createMessageObject(QUOTE_REQUEST_ERROR_MESSAGES.NOT_OPEN) })
  @SwaggerResponse(404, {
    dataExample: createMessageObject(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND),
  })
  async close(@Param("id") id: string, @Request() req: { user: JwtVerifiedPayload }) {
    await this.writeService.closeForConsumer(req.user.sub, id);
    return { message: QUOTE_REQUEST_SUCCESS_MESSAGES.CLOSED };
  }
}
