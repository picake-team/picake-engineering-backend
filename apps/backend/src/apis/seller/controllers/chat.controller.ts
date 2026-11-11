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
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { ChatService } from "@apps/backend/modules/chat/services/chat.service";
import {
  ChatExistingThreadDto,
  ChatListQueryDto,
  ChatMessagesDto,
  ChatMessagesQueryDto,
  ChatReportDto,
  ChatRulesAgreeDto,
  ChatSendDto,
  ChatSendResultDto,
  ChatThreadDetailDto,
  ChatThreadListDto,
  ChatToggleDto,
  ChatUnreadDto,
} from "@apps/backend/modules/chat/dto/chat.dto";

const POLL_THROTTLE = { default: { limit: 300, ttl: 60_000 } };

/**
 * 사장님 채팅(기획 I-11) — 스토어마다. 가게는 먼저 말을 걸 수 없고,
 * 손님 마지막 글 30일 안이거나 픽업 전 예약이 있을 때만 쓴다(주문 상세에서 먼저 열기 포함).
 */
@ApiTags("채팅")
@ApiExtraModels(
  ChatThreadListDto,
  ChatThreadDetailDto,
  ChatMessagesDto,
  ChatSendResultDto,
  ChatUnreadDto,
  ChatExistingThreadDto,
)
@Controller(`${AUDIENCE.SELLER}/stores/:storeId/chats`)
@Auth({ isPublic: false, audiences: ["seller"] })
export class SellerChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @ApiOperation({ summary: "채팅 목록(filter=reply: 답할 것 / all: 전체)" })
  @SwaggerResponse(200, { dataDto: ChatThreadListDto })
  @SwaggerAuthResponses()
  async list(
    @Param("storeId") storeId: string,
    @Query() query: ChatListQueryDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.listForStore(req.user.sub, storeId, query);
  }

  @Get("unread")
  @Throttle(POLL_THROTTLE)
  @ApiOperation({
    summary: "안 읽은 방·답할 방 수(아래 탭 숫자, 홈 '답할 채팅'). 닫혀 있으면 open=false",
  })
  @SwaggerResponse(200, { dataDto: ChatUnreadDto })
  @SwaggerAuthResponses()
  async unread(@Param("storeId") storeId: string, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.unreadForStore(req.user.sub, storeId);
  }

  @Post("rules/agree")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "채팅 이용 규칙 동의(사장님, 처음 보낼 때 한 번)" })
  @SwaggerAuthResponses()
  async agree(@Body() dto: ChatRulesAgreeDto, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.agreeRules("SELLER", req.user.sub, dto.version);
  }

  @Get("orders/:orderId")
  @ApiOperation({
    summary: "주문 상세 '채팅': 이 주문 손님과의 방(있으면)과 먼저 쓸 수 있는지(픽업 전 예약)",
  })
  @SwaggerResponse(200, { dataDto: ChatExistingThreadDto })
  @SwaggerAuthResponses()
  async byOrder(
    @Param("storeId") storeId: string,
    @Param("orderId") orderId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.byOrderForStore(req.user.sub, storeId, orderId);
  }

  @Post("orders/:orderId/messages")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "픽업 전 예약 손님에게 먼저 보내기(방이 없으면 생김, 주문 카드가 한 번 붙음)",
  })
  @SwaggerResponse(201, { dataDto: ChatSendResultDto })
  @SwaggerAuthResponses()
  async startFromOrder(
    @Param("storeId") storeId: string,
    @Param("orderId") orderId: string,
    @Body() dto: ChatSendDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.startFromOrderForStore(req.user.sub, storeId, orderId, dto);
  }

  @Get(":threadId")
  @ApiOperation({ summary: "채팅방 정보(쓸 수 있나, 손님이 읽은 때)" })
  @SwaggerResponse(200, { dataDto: ChatThreadDetailDto })
  @SwaggerAuthResponses()
  async thread(
    @Param("storeId") storeId: string,
    @Param("threadId") threadId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.threadForStore(req.user.sub, storeId, threadId);
  }

  @Get(":threadId/messages")
  @Throttle(POLL_THROTTLE)
  @ApiOperation({
    summary: "글 가져오기(after: 새 글 / before: 위로 더 보기, markRead=true면 읽음)",
  })
  @SwaggerResponse(200, { dataDto: ChatMessagesDto })
  @SwaggerAuthResponses()
  async messages(
    @Param("storeId") storeId: string,
    @Param("threadId") threadId: string,
    @Query() query: ChatMessagesQueryDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.messagesForStore(req.user.sub, storeId, threadId, query);
  }

  @Post(":threadId/messages")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "보내기" })
  @SwaggerResponse(201, { dataDto: ChatSendResultDto })
  @SwaggerAuthResponses()
  async send(
    @Param("storeId") storeId: string,
    @Param("threadId") threadId: string,
    @Body() dto: ChatSendDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.sendForStore(req.user.sub, storeId, threadId, dto);
  }

  @Post(":threadId/mute")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "이 채팅 알림 끄기·켜기(value=true면 끔)" })
  @SwaggerResponse(200, { dataDto: ChatThreadDetailDto })
  @SwaggerAuthResponses()
  async mute(
    @Param("storeId") storeId: string,
    @Param("threadId") threadId: string,
    @Body() dto: ChatToggleDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.setStoreFlag(req.user.sub, storeId, threadId, "mute", dto.value);
  }

  @Post(":threadId/block")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "손님 차단·풀기(value=true면 차단)" })
  @SwaggerResponse(200, { dataDto: ChatThreadDetailDto })
  @SwaggerAuthResponses()
  async block(
    @Param("storeId") storeId: string,
    @Param("threadId") threadId: string,
    @Body() dto: ChatToggleDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.setStoreFlag(req.user.sub, storeId, threadId, "block", dto.value);
  }

  @Post(":threadId/reports")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "신고(운영자에게 바로 알림, 24시간 안 확인)" })
  @SwaggerAuthResponses()
  async report(
    @Param("storeId") storeId: string,
    @Param("threadId") threadId: string,
    @Body() dto: ChatReportDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.reportForStore(req.user.sub, storeId, threadId, dto);
  }
}
