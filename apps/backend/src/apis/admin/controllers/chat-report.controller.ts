import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
  Request,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { ChatAdminService } from "@apps/backend/modules/chat/services/chat-admin.service";
import {
  AdminChatOpenDto,
  AdminChatReportListQueryDto,
  AdminChatReportResolveDto,
} from "@apps/backend/modules/chat/dto/chat.dto";

/**
 * 관리자 채팅(기획 I-11): 신고 처리(24시간 안, 애플 1.2)와 채팅 여는 시각.
 * 신고 상세를 열면 열람 기록(chat_access_logs)이 남는다.
 */
@ApiTags("관리자 - 채팅")
@Controller(`${AUDIENCE.ADMIN}/chat`)
@Auth({ isPublic: false, audiences: [AUDIENCE.ADMIN] })
export class AdminChatController {
  constructor(private readonly chatAdmin: ChatAdminService) {}

  @Get("open")
  @ApiOperation({ summary: "채팅 여는 시각과 지금 열렸는지" })
  @SwaggerAuthResponses()
  async getOpen() {
    return this.chatAdmin.getOpenConfig();
  }

  @Put("open")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "채팅 여는 시각 정하기(처리방침·약관 시행 시각). null이면 바로 닫힘",
  })
  @SwaggerAuthResponses()
  async setOpen(@Body() dto: AdminChatOpenDto) {
    return this.chatAdmin.setOpenConfig(dto.chatOpensAt);
  }

  @Get("reports")
  @ApiOperation({ summary: "채팅 신고 목록(최근 100개)" })
  @SwaggerAuthResponses()
  async reports(@Query() query: AdminChatReportListQueryDto) {
    return this.chatAdmin.listReports(query);
  }

  @Get("reports/:id")
  @ApiOperation({ summary: "채팅 신고 상세(최근 대화 50개, 원문). 열람 기록이 남습니다" })
  @SwaggerAuthResponses()
  async report(@Param("id") id: string, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatAdmin.getReport(req.user.sub, id);
  }

  @Patch("reports/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "채팅 신고 처리(메시지 가리기 / 그대로 두기)" })
  @SwaggerAuthResponses()
  async resolve(
    @Param("id") id: string,
    @Body() dto: AdminChatReportResolveDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatAdmin.resolveReport(req.user.sub, id, dto);
  }
}
