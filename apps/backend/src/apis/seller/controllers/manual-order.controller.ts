import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
} from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { ThrottleMessage } from "@apps/backend/common/decorators/throttle-message.decorator";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import {
  MANUAL_ORDER_READ_ERROR_MESSAGES,
  MANUAL_ORDER_READ_LIMITS,
} from "@apps/backend/modules/manual-order/constants/manual-order.constants";
import {
  CalendarFeedDto,
  CalendarFeedSettingsInputDto,
  ManualOrderDto,
  ManualOrderInputDto,
  ManualOrderListQueryDto,
  ManualOrderListResponseDto,
  ManualOrderPaidInputDto,
  ManualOrderReadRequestDto,
  ManualOrderReadResponseDto,
} from "@apps/backend/modules/manual-order/dto/manual-order.dto";
import { ManualOrderService } from "@apps/backend/modules/manual-order/services/manual-order.service";
import { ManualOrderReadService } from "@apps/backend/modules/manual-order/services/manual-order-read.service";
import { CalendarFeedService } from "@apps/backend/modules/manual-order/services/calendar-feed.service";

/**
 * 판매자 앱 직접 적은 주문(기획 I-42): Picake 밖(카톡·인스타·전화 등)에서 받은 주문을 적어 Picake 주문과 같은 달력에 본다.
 * 사장님 장부라 알림톡·수수료·정산·관리자 숫자와 상관없다.
 */
@ApiTags("[판매자] 직접 적은 주문")
@ApiExtraModels(
  ManualOrderDto,
  ManualOrderListResponseDto,
  ManualOrderReadResponseDto,
  CalendarFeedDto,
)
@Controller(`${AUDIENCE.SELLER}/stores/:storeId`)
@Auth({ isPublic: false, audiences: ["seller"] })
export class SellerManualOrderController {
  constructor(
    private readonly manualOrderService: ManualOrderService,
    private readonly readService: ManualOrderReadService,
    private readonly calendarFeedService: CalendarFeedService,
  ) {}

  @Get("manual-orders")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 기간 안의 직접 적은 주문",
    description:
      "픽업 날(startDate~endDate, 그날 포함, 62일까지) 순, 같은 날은 시각 순(시각 없으면 맨 뒤).",
  })
  @SwaggerResponse(200, { dataDto: ManualOrderListResponseDto })
  @SwaggerAuthResponses()
  async list(
    @Param("storeId") storeId: string,
    @Query() query: ManualOrderListQueryDto,
    @Request() req: { user: JwtVerifiedPayload },
  ): Promise<ManualOrderListResponseDto> {
    return {
      data: await this.manualOrderService.list(
        req.user.sub,
        storeId,
        query.startDate,
        query.endDate,
      ),
    };
  }

  @Post("manual-orders")
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: "(로그인 필요) 주문 적기" })
  @SwaggerResponse(201, { dataDto: ManualOrderDto })
  @SwaggerAuthResponses()
  async create(
    @Param("storeId") storeId: string,
    @Body() dto: ManualOrderInputDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.manualOrderService.create(req.user.sub, storeId, dto);
  }

  @Post("manual-orders/read")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: MANUAL_ORDER_READ_LIMITS.PER_MINUTE, ttl: 60000 } })
  @ThrottleMessage(MANUAL_ORDER_READ_ERROR_MESSAGES.TOO_FAST)
  @ApiOperation({
    summary: "(로그인 필요) 대화 붙여 넣어 채우기",
    description:
      "붙여 넣은 대화 글(text) 또는 대화 캡처(image, JPG·PNG data URL 2.5MB까지)를 Claude가 읽어 주문 적기 칸을 채울 값을 돌려줍니다. " +
      "글이 있으면 글을 읽습니다. 주문으로 읽을 내용이 없으면 found false. 대화·캡처는 저장하지 않습니다. " +
      "한도: 하루 60번(사장님마다), 넘으면 429 '오늘은 대화 읽기를 다 썼어요. 직접 적어 주세요.' · 분당 10번, 넘으면 429 '잠시 후 다시 시도해 주세요.' · " +
      "모든 사장님을 합쳐 하루 2,000번, 넘으면 503. Claude는 20초까지만 기다리고, 실패·시간 초과는 502이고 한도에서 세지 않습니다.",
  })
  @SwaggerResponse(200, { dataDto: ManualOrderReadResponseDto })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(MANUAL_ORDER_READ_ERROR_MESSAGES.EMPTY),
  })
  @SwaggerResponse(429, {
    dataExample: createMessageObject(MANUAL_ORDER_READ_ERROR_MESSAGES.DAILY_LIMIT),
  })
  @SwaggerResponse(502, {
    dataExample: createMessageObject(MANUAL_ORDER_READ_ERROR_MESSAGES.FAILED),
  })
  @SwaggerResponse(503, {
    dataExample: createMessageObject(MANUAL_ORDER_READ_ERROR_MESSAGES.UNAVAILABLE),
  })
  @SwaggerAuthResponses()
  async read(
    @Param("storeId") storeId: string,
    @Body() dto: ManualOrderReadRequestDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.readService.read(req.user.sub, storeId, dto);
  }

  @Get("manual-orders/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 직접 적은 주문 하나" })
  @SwaggerResponse(200, { dataDto: ManualOrderDto })
  @SwaggerAuthResponses()
  async get(
    @Param("storeId") storeId: string,
    @Param("id") id: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.manualOrderService.get(req.user.sub, storeId, id);
  }

  @Put("manual-orders/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 고치기(모든 칸을 보낸다)" })
  @SwaggerResponse(200, { dataDto: ManualOrderDto })
  @SwaggerAuthResponses()
  async update(
    @Param("storeId") storeId: string,
    @Param("id") id: string,
    @Body() dto: ManualOrderInputDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.manualOrderService.update(req.user.sub, storeId, id, dto);
  }

  @Patch("manual-orders/:id/paid")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 입금 전·받음만 바로 바꾸기" })
  @SwaggerResponse(200, { dataDto: ManualOrderDto })
  @SwaggerAuthResponses()
  async setPaid(
    @Param("storeId") storeId: string,
    @Param("id") id: string,
    @Body() dto: ManualOrderPaidInputDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.manualOrderService.setPaid(req.user.sub, storeId, id, dto.paid);
  }

  @Delete("manual-orders/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 지우기" })
  @SwaggerAuthResponses()
  async remove(
    @Param("storeId") storeId: string,
    @Param("id") id: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.manualOrderService.remove(req.user.sub, storeId, id);
    return { deleted: true };
  }

  @Get("calendar-feed")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 다른 캘린더로 내보내기 주소",
    description:
      "처음 열면 주소를 만듭니다. 주소의 경로(path)를 API 주소 뒤에 붙여 아이폰(webcal://)·구글(cid)로 엽니다.",
  })
  @SwaggerResponse(200, { dataDto: CalendarFeedDto })
  @SwaggerAuthResponses()
  async getCalendarFeed(
    @Param("storeId") storeId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.calendarFeedService.get(req.user.sub, storeId);
  }

  @Patch("calendar-feed")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 내보낸 일정에 손님 이름 보이기" })
  @SwaggerResponse(200, { dataDto: CalendarFeedDto })
  @SwaggerAuthResponses()
  async updateCalendarFeed(
    @Param("storeId") storeId: string,
    @Body() dto: CalendarFeedSettingsInputDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.calendarFeedService.updateSettings(
      req.user.sub,
      storeId,
      dto.showCustomerName,
    );
  }

  @Post("calendar-feed/reset")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "(로그인 필요) 주소 새로 만들기(옛 주소는 끊김)" })
  @SwaggerResponse(200, { dataDto: CalendarFeedDto })
  @SwaggerAuthResponses()
  async resetCalendarFeed(
    @Param("storeId") storeId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.calendarFeedService.reset(req.user.sub, storeId);
  }
}
