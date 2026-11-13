import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { UploadService } from "@apps/backend/modules/upload/upload.service";
import {
  UPLOAD_CONSTANTS,
  UPLOAD_ERROR_MESSAGES,
} from "@apps/backend/modules/upload/constants/upload.constants";
import { ChatMessagesQueryDto, ChatSendDto } from "@apps/backend/modules/chat/dto/chat.dto";
import {
  QuoteDeclineInputDto,
  QuoteDto,
  QuoteInputDto,
  QuoteLinkViewDto,
} from "@apps/backend/modules/quote-request/dto/quote.dto";
import { QuoteService } from "@apps/backend/modules/quote-request/services/quote.service";

/**
 * 견적 링크(기획 I-46 SC-19) — 입점 전 가게 사장님이 가입 없이 견적을 보내고, 손님과 대화한다.
 * 링크 열쇠(token)가 곧 그 가게로서 답하는 권한이다. 로그인 없이 쓰므로 요청 수를 낮게 막는다.
 */
@ApiTags("견적 링크(가입 없이)")
@ApiExtraModels(QuoteLinkViewDto, QuoteDto)
@Controller(`${AUDIENCE.CONSUMER}/quote-links/:token`)
@Auth({ isPublic: true })
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class ConsumerQuoteLinkController {
  constructor(
    private readonly quoteService: QuoteService,
    private readonly uploadService: UploadService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "견적 링크 열기",
    description:
      "손님 요청서(이름·연락처 없이, 지역은 동네까지)와 이 가게 쪽 상태(받는 중·보냄·어려워요·골랐어요·마감), 보낸 견적, 대화 상태. 처음 열면 운영자 화면에 '열어 봄'이 남습니다.",
  })
  @SwaggerResponse(200, { dataDto: QuoteLinkViewDto })
  async view(@Param("token") token: string) {
    return await this.quoteService.linkView(token);
  }

  @Post("quote")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "견적 보내기·고치기",
    description:
      "금액(1개)·비슷한 정도·사진(3장)·메모·손님이 연락할 곳(선택, 손님이 이 가게를 고른 뒤에만 보임). 주문은 대화에서 정한다. 손님이 고르기 전까지 고칠 수 있고, 고치면 손님에게 '견적이 바뀌었어요'가 갑니다.",
  })
  @SwaggerResponse(200, { dataDto: QuoteDto })
  async submit(@Param("token") token: string, @Body() dto: QuoteInputDto) {
    return await this.quoteService.linkSubmit(token, dto);
  }

  @Post("decline")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "어려워요",
    description: "이유 하나를 골라 답합니다. 손님에게는 한 줄로 보입니다.",
  })
  async decline(@Param("token") token: string, @Body() dto: QuoteDeclineInputDto) {
    await this.quoteService.linkDecline(token, dto.reason);
    return { declined: true };
  }

  @Post("photos")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_CONSTANTS.MAX_FILE_SIZE } }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "사진 올리기(비슷하게 만든 케이크·대화 사진)",
    description: "견적을 받는 중이거나 대화가 열려 있을 때만 올릴 수 있습니다. 최대 10MB.",
  })
  async upload(
    @Param("token") token: string,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer } | undefined,
  ) {
    await this.quoteService.assertLinkCanUpload(token);
    if (!file) throw new BadRequestException(UPLOAD_ERROR_MESSAGES.FILE_NOT_UPLOADED);
    const fileUrl = await this.uploadService.uploadFile({
      originalname: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer,
    });
    return { fileUrl };
  }

  @Get("chat/messages")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "링크 안 대화 읽기",
    description: "견적을 보낸 뒤 생긴 손님과의 대화. 아직 대화가 없으면 messages가 비어 있습니다.",
  })
  async messages(@Param("token") token: string, @Query() query: ChatMessagesQueryDto) {
    return (
      (await this.quoteService.linkMessages(token, query)) ?? {
        messages: [],
        hasMore: false,
        thread: null,
      }
    );
  }

  @Post("chat/messages")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: "링크 안 대화 보내기",
    description: "고른 뒤 14일, 고르지 않으면 마감 뒤 7일까지 쓸 수 있습니다.",
  })
  async send(@Param("token") token: string, @Body() dto: ChatSendDto) {
    return await this.quoteService.linkSend(token, dto);
  }
}
