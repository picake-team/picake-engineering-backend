import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { CALENDAR_FEED_ERROR_MESSAGES } from "@apps/backend/modules/manual-order/constants/manual-order.constants";
import { CalendarFeedService } from "@apps/backend/modules/manual-order/services/calendar-feed.service";

/**
 * 다른 캘린더로 내보내기(기획 I-42)의 구독 주소. 아이폰·구글 캘린더가 로그인 없이 주기적으로 읽는다.
 * 주소의 비밀 값이 곧 열쇠다(끊는 API `calendar-feed/reset`은 있지만 11-17부터 화면 버튼은 없다). 다른 응답과 달리 감싸지 않은 ics 글을 준다.
 */
@ApiTags("[판매자] 직접 적은 주문")
@Controller(`${AUDIENCE.SELLER}/calendar-feeds`)
@Auth({ isPublic: true })
export class SellerCalendarFeedController {
  constructor(private readonly calendarFeedService: CalendarFeedService) {}

  @Get(":file")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: "구독용 캘린더(ics, 로그인 없음)",
    description:
      "`{비밀 값}.ics`. Picake 예약(취소·노쇼 빼고)과 직접 적은 주문, 지난 60일부터 앞으로 1년.",
  })
  async feed(@Param("file") file: string, @Res() res: Response): Promise<void> {
    if (!file.endsWith(".ics")) throw new NotFoundException(CALENDAR_FEED_ERROR_MESSAGES.NOT_FOUND);
    const ics = await this.calendarFeedService.buildIcs(file.slice(0, -".ics".length));
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="picake.ics"');
    res.setHeader("Cache-Control", "private, max-age=300");
    // 주소의 비밀 값이 검색·다른 사이트로 새지 않게
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.status(200).send(ics);
  }
}
