import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AllowActAs } from "@apps/backend/modules/auth/decorators/allow-act-as.decorator";
import {
  AUDIENCE,
  AUTH_ERROR_MESSAGES,
  TOKEN_TYPES,
} from "@apps/backend/modules/auth/constants/auth.constants";
import type { AuthenticatedUser } from "@apps/backend/modules/auth/types/auth.types";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { ThrottleMessage } from "@apps/backend/common/decorators/throttle-message.decorator";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";
import {
  ActAsMeResponseDto,
  ExchangeActAsCodeRequestDto,
  ExchangeActAsCodeResponseDto,
} from "@apps/backend/modules/act-as/dto/act-as.dto";
import { ActAsSessionService } from "@apps/backend/modules/act-as/services/act-as-session.service";

/**
 * 판매자 화면 쪽 운영자 대신 입력(기획 I-41): 들어오기(코드 → 대리 출입증), 위 띠, 끝내기.
 * 띠·끝내기는 대리 출입증(`type: act_as`)만 받는다 — 사장님 출입증으로는 부를 수 없다.
 */
@ApiTags("[판매자] 운영자 대신 입력")
@ApiExtraModels(ExchangeActAsCodeResponseDto, ActAsMeResponseDto)
@Controller(`${AUDIENCE.SELLER}/act-as`)
export class SellerActAsController {
  constructor(private readonly actAsSessionService: ActAsSessionService) {}

  @Post("exchange")
  @Auth({ isPublic: true })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ThrottleMessage("잠시 후 다시 시도해 주세요.")
  @ApiOperation({
    summary: "(공개) 들어오기 코드를 대리 출입증으로 바꾸기",
    description:
      "관리자 화면이 연 주소의 code(60초, 한 번만)를 대리 출입증으로 바꿉니다. 출입증은 세션이 끝나는 시각까지(최대 60분). 분당 5번.",
  })
  @SwaggerResponse(200, { dataDto: ExchangeActAsCodeResponseDto })
  @SwaggerResponse(400, { dataExample: createMessageObject(ACT_AS_ERROR_MESSAGES.CODE_INVALID) })
  async exchange(@Body() dto: ExchangeActAsCodeRequestDto) {
    return await this.actAsSessionService.exchange(dto.code);
  }

  @Get("me")
  @Auth({ isPublic: false, audiences: [AUDIENCE.SELLER], jwtTypes: [TOKEN_TYPES.ACT_AS] })
  @AllowActAs()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(대리 출입증만) 위 띠에 쓸 가게 이름·끝나는 시각",
  })
  @SwaggerResponse(200, { dataDto: ActAsMeResponseDto })
  @SwaggerAuthResponses()
  async me(@Request() req: { user: AuthenticatedUser }) {
    if (!req.user.actor) throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACT_AS_SESSION_ENDED);
    return await this.actAsSessionService.me(req.user.actor);
  }

  @Post("end")
  @Auth({ isPublic: false, audiences: [AUDIENCE.SELLER], jwtTypes: [TOKEN_TYPES.ACT_AS] })
  @AllowActAs()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(대리 출입증만) 끝내기 — 출입증은 바로 무효" })
  @SwaggerResponse(200, { dataExample: { ended: true } })
  @SwaggerAuthResponses()
  async end(@Request() req: { user: AuthenticatedUser }) {
    if (!req.user.actor) throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACT_AS_SESSION_ENDED);
    return await this.actAsSessionService.endSelf(req.user.actor);
  }
}
