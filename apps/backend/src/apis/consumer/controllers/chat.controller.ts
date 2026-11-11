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
  ChatStatusDto,
  ChatThreadDetailDto,
  ChatThreadListDto,
  ChatToggleDto,
  ChatUnreadDto,
  ConsumerStartChatDto,
} from "@apps/backend/modules/chat/dto/chat.dto";

/** 새 글 확인은 소켓 신호 + 15초(끊기면 3초)마다라 한 사람·주소당 넉넉히. 통신사 공용 IP 뒤 손님들이 서로 막지 않게 */
const POLL_THROTTLE = { default: { limit: 300, ttl: 60_000 } };

/** 채팅 열렸나(로그인 없이) — 스토어 문의 창 입구를 보일지 정한다 */
@ApiTags("채팅")
@ApiExtraModels(ChatStatusDto)
@Controller(`${AUDIENCE.CONSUMER}/chat-status`)
@Auth({ isPublic: true })
export class ConsumerChatStatusController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "채팅이 열렸나(관리자 설정의 여는 시각)와 이용 규칙 버전" })
  @SwaggerResponse(200, { dataDto: ChatStatusDto })
  async status() {
    return this.chatService.status();
  }
}

/**
 * 손님 채팅(기획 I-11) — 손님 × 입점 가게. 방은 첫 글을 보낼 때 생긴다.
 * 채팅이 닫혀 있으면(여는 시각 전) 403 "채팅은 아직 준비 중이에요."
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
@Controller(`${AUDIENCE.CONSUMER}/chats`)
@Auth({ isPublic: false, audiences: ["consumer"] })
export class ConsumerChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @ApiOperation({ summary: "(로그인 필요) 내 채팅 목록(최근 글 순)" })
  @SwaggerResponse(200, { dataDto: ChatThreadListDto })
  @SwaggerAuthResponses()
  async list(@Query() query: ChatListQueryDto, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.listForConsumer(req.user.sub, query);
  }

  @Get("unread")
  @Throttle(POLL_THROTTLE)
  @ApiOperation({ summary: "(로그인 필요) 안 읽은 채팅 방 수(MY 점·숫자). 닫혀 있으면 open=false" })
  @SwaggerResponse(200, { dataDto: ChatUnreadDto })
  @SwaggerAuthResponses()
  async unread(@Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.unreadForConsumer(req.user.sub);
  }

  @Post("rules/agree")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 채팅 이용 규칙 동의(처음 보낼 때 한 번)" })
  @SwaggerAuthResponses()
  async agree(@Body() dto: ChatRulesAgreeDto, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.agreeRules("CONSUMER", req.user.sub, dto.version);
  }

  @Get("stores/:storeId")
  @ApiOperation({
    summary:
      "(로그인 필요) 이 가게와의 방(있으면). 없으면 threadId=null — 첫 글을 보낼 때 생깁니다",
  })
  @SwaggerResponse(200, { dataDto: ChatExistingThreadDto })
  @SwaggerAuthResponses()
  async byStore(@Param("storeId") storeId: string, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.existingForConsumer(req.user.sub, storeId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "(로그인 필요) 가게에 보내기(방이 없으면 생김)",
    description:
      "주문 상세에서 열었으면 orderId(내 주문), 상품에서 열었으면 productId를 넣으면 그 카드가 글 앞에 한 번 붙습니다. " +
      "clientId가 같으면 다시 보내도 한 번만 저장됩니다.",
  })
  @SwaggerResponse(201, { dataDto: ChatSendResultDto })
  @SwaggerAuthResponses()
  async start(@Body() dto: ConsumerStartChatDto, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.startForConsumer(req.user.sub, dto);
  }

  @Get(":threadId")
  @ApiOperation({ summary: "(로그인 필요) 채팅방 정보(쓸 수 있나, 상대가 읽은 때)" })
  @SwaggerResponse(200, { dataDto: ChatThreadDetailDto })
  @SwaggerAuthResponses()
  async thread(@Param("threadId") threadId: string, @Request() req: { user: JwtVerifiedPayload }) {
    return this.chatService.threadForConsumer(req.user.sub, threadId);
  }

  @Get(":threadId/messages")
  @Throttle(POLL_THROTTLE)
  @ApiOperation({
    summary: "(로그인 필요) 글 가져오기",
    description:
      "after: 그 글 다음 것(새 글 확인) / before: 그 앞 30개(위로 더 보기) / 둘 다 없으면 최근 30개. markRead=true면 읽음으로 저장",
  })
  @SwaggerResponse(200, { dataDto: ChatMessagesDto })
  @SwaggerAuthResponses()
  async messages(
    @Param("threadId") threadId: string,
    @Query() query: ChatMessagesQueryDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.messagesForConsumer(req.user.sub, threadId, query);
  }

  @Post(":threadId/messages")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "(로그인 필요) 보내기" })
  @SwaggerResponse(201, { dataDto: ChatSendResultDto })
  @SwaggerAuthResponses()
  async send(
    @Param("threadId") threadId: string,
    @Body() dto: ChatSendDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.sendForConsumer(req.user.sub, threadId, dto);
  }

  @Post(":threadId/mute")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 이 채팅 알림 끄기·켜기(value=true면 끔)" })
  @SwaggerResponse(200, { dataDto: ChatThreadDetailDto })
  @SwaggerAuthResponses()
  async mute(
    @Param("threadId") threadId: string,
    @Body() dto: ChatToggleDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.setConsumerFlag(req.user.sub, threadId, "mute", dto.value);
  }

  @Post(":threadId/block")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 가게 차단·풀기(value=true면 차단)" })
  @SwaggerResponse(200, { dataDto: ChatThreadDetailDto })
  @SwaggerAuthResponses()
  async block(
    @Param("threadId") threadId: string,
    @Body() dto: ChatToggleDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.setConsumerFlag(req.user.sub, threadId, "block", dto.value);
  }

  @Post(":threadId/reports")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "(로그인 필요) 신고(운영자에게 바로 알림, 24시간 안 확인)" })
  @SwaggerAuthResponses()
  async report(
    @Param("threadId") threadId: string,
    @Body() dto: ChatReportDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return this.chatService.reportForConsumer(req.user.sub, threadId, dto);
  }
}
