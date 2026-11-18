import {
  ForbiddenException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
} from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AUDIENCE, AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import type { AuthenticatedUser } from "@apps/backend/modules/auth/types/auth.types";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";
import {
  ActAsActionItemDto,
  ActAsActionListResponseDto,
  ActAsActionSummaryDto,
  ActAsSessionItemDto,
  ActAsSessionListResponseDto,
  StartActAsSessionRequestDto,
  StartActAsSessionResponseDto,
} from "@apps/backend/modules/act-as/dto/act-as.dto";
import { ActAsSessionService } from "@apps/backend/modules/act-as/services/act-as-session.service";

/**
 * 운영자가 가게 대신 입력하기(기획 I-41) — 관리자 스토어 상세의 "이 가게로 들어가기"와 "대리 입력 기록".
 * 시작은 사람 관리자만(API 키 거절), 환경값 `ADMIN_ACT_AS_USERNAMES`에 적은 관리자만, OTP를 다시 받는다.
 */
@ApiTags("[관리자] 가게 대신 입력")
@ApiExtraModels(
  StartActAsSessionResponseDto,
  ActAsSessionItemDto,
  ActAsSessionListResponseDto,
  ActAsActionSummaryDto,
  ActAsActionItemDto,
  ActAsActionListResponseDto,
)
@Controller(AUDIENCE.ADMIN)
@Auth({ isPublic: false, audiences: [AUDIENCE.ADMIN] })
export class AdminActAsSessionController {
  constructor(private readonly actAsSessionService: ActAsSessionService) {}

  @Post("stores/:storeId/act-as-sessions")
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요, 사람 관리자 전용) 이 가게로 들어가기",
    description:
      "사유와 OTP 6자리를 받아 60분 세션을 만들고, 판매자 화면 들어오기 주소(한 번만 쓰는 코드, 60초)를 돌려줍니다. " +
      "환경값에 적은 관리자만, 심사용 가게·꺼진 판매자는 거절. 디스코드 【PICAKE】운영에 알립니다.",
  })
  @SwaggerResponse(201, { dataDto: StartActAsSessionResponseDto })
  @SwaggerResponse(400, { dataExample: createMessageObject(AUTH_ERROR_MESSAGES.OTP_CODE_INVALID) })
  @SwaggerResponse(403, {
    dataExample: createMessageObject(ACT_AS_ERROR_MESSAGES.ADMIN_NOT_ALLOWED),
  })
  @SwaggerAuthResponses()
  async start(
    @Param("storeId") storeId: string,
    @Body() dto: StartActAsSessionRequestDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return await this.actAsSessionService.start(req.user, storeId, dto);
  }

  @Get("stores/:storeId/act-as-sessions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 이 가게 대리 입력 기록",
    description:
      "최근 50개 세션(누가·사유·시작·끝·상태)과 무엇을 몇 번 했는지(성공한 쓰기·본 화면·막힌 요청).",
  })
  @SwaggerResponse(200, { dataDto: ActAsSessionListResponseDto })
  @SwaggerAuthResponses()
  async listForStore(@Param("storeId") storeId: string): Promise<ActAsSessionListResponseDto> {
    return { data: await this.actAsSessionService.listForStore(storeId) };
  }

  @Get("act-as-sessions/:id/actions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 세션 안의 요청 기록",
    description: "경로 틀·대상 id·보낸 칸 이름·결과만(보낸 값은 남기지 않음). 시간 순 500개까지.",
  })
  @SwaggerResponse(200, { dataDto: ActAsActionListResponseDto })
  @SwaggerAuthResponses()
  async listActions(@Param("id") id: string): Promise<ActAsActionListResponseDto> {
    return { data: await this.actAsSessionService.listActions(id) };
  }

  @Post("act-as-sessions/:id/end")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 세션 바로 끝내기",
    description: "다른 탭·다른 관리자 세션도 끝냅니다. 그 출입증은 다음 요청부터 401.",
  })
  @SwaggerResponse(200, { dataExample: { ended: true } })
  @SwaggerAuthResponses()
  async end(@Param("id") id: string, @Request() req: { user: AuthenticatedUser }) {
    // 자동화용 관리자 API 키는 끝내기도 못 한다(끝낸 사람이 사람 관리자와 섞이지 않게)
    if (req.user.isApiKey) throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.HUMAN_ONLY);
    return await this.actAsSessionService.endByAdmin(id, req.user.id);
  }
}
