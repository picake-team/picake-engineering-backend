import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { QuoteRequestStatus } from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { ChatService } from "@apps/backend/modules/chat/services/chat.service";
import { OrderCreateService } from "@apps/backend/modules/order/services/order-create.service";
import {
  QUOTE_ERROR_MESSAGES,
  QUOTE_RESERVATION_ACTIVE_STATUSES,
} from "@apps/backend/modules/quote-request/constants/quote.constants";
import { QUOTE_REQUEST_ERROR_MESSAGES } from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import type {
  ReserveQuoteDto,
  ReserveQuoteResponseDto,
} from "@apps/backend/modules/quote-request/dto/quote.dto";
import { quoteTotal } from "@apps/backend/modules/quote-request/utils/quote-policy.util";
import { formatQuoteOrderName } from "@apps/backend/modules/quote-request/utils/quote-request-label.util";

/**
 * 견적으로 예약하기(기획 I-01, 운영자 결정 2026-11-13).
 * 입점 가게 견적을 고른 손님이 픽업 일시를 골라 예약신청을 만든다. 이후(사장님 예약 확인 → 입금대기 → …)는
 * 상품 예약과 같은 주문 흐름·알림톡·사장님 화면을 그대로 쓴다. 입점 전 가게는 견적 링크 안 대화로 끝까지 정한다.
 */
@Injectable()
export class QuoteReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderCreate: OrderCreateService,
    private readonly chat: ChatService,
  ) {}

  async reserve(
    consumerId: string,
    requestId: string,
    dto: ReserveQuoteDto,
  ): Promise<ReserveQuoteResponseDto> {
    const r = await this.prisma.quoteRequest.findFirst({
      where: { id: requestId, consumerId },
      select: {
        id: true,
        status: true,
        chosenTargetId: true,
        size: true,
        quantity: true,
        creams: true,
        flavorNote: true,
        photoUrls: true,
        consumer: { select: { name: true, nickname: true, phone: true } },
      },
    });
    if (!r) throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    if (!r.chosenTargetId) throw new BadRequestException(QUOTE_ERROR_MESSAGES.RESERVE_NOT_CHOSEN);
    if (r.status !== QuoteRequestStatus.CONNECTED) {
      throw new BadRequestException(QUOTE_ERROR_MESSAGES.RESERVE_CLOSED);
    }
    const target = await this.prisma.quoteRequestStore.findUnique({
      where: { id: r.chosenTargetId },
      select: {
        storeId: true,
        shopId: true,
        quote: { select: { id: true, unitPrice: true, photoUrls: true } },
      },
    });
    if (!target?.quote) throw new BadRequestException(QUOTE_ERROR_MESSAGES.RESERVE_NOT_CHOSEN);
    if (!target.storeId) throw new BadRequestException(QUOTE_ERROR_MESSAGES.RESERVE_UNENTERED);

    // 예약자 칸을 비우면 가입한 이름·번호(상품 예약 창과 같게)
    const contactName =
      dto.reservationContactName ??
      (r.consumer.name?.trim() || r.consumer.nickname?.trim() || null);
    const contactPhone = dto.reservationPhone ?? r.consumer.phone;
    const quote = target.quote;
    const total = quoteTotal(quote.unitPrice, r.quantity);
    if (dto.expectedTotal !== undefined && dto.expectedTotal !== total) {
      throw new BadRequestException(QUOTE_ERROR_MESSAGES.RESERVE_PRICE_CHANGED);
    }
    const created = await this.orderCreate.createOrderFromQuote({
      consumerId,
      storeId: target.storeId,
      quoteId: quote.id,
      productName: formatQuoteOrderName(r),
      // 사장님 견적 사진이 있으면 그것, 없으면 손님 참고 사진(주문 목록·알림에 보이는 그림)
      productImages: (quote.photoUrls.length ? quote.photoUrls : r.photoUrls).slice(0, 3),
      totalQuantity: r.quantity,
      totalPrice: total,
      pickupAt: new Date(dto.pickupDate),
      reservationContactName: contactName,
      reservationPhone: contactPhone,
      activeStatuses: QUOTE_RESERVATION_ACTIVE_STATUSES,
    });

    // 채팅방에 예약 카드(실패해도 예약은 그대로)
    if (target.shopId) {
      try {
        const order = await this.prisma.order.findUnique({
          where: { id: created.id },
          select: {
            id: true,
            orderNumber: true,
            productName: true,
            productImages: true,
            pickupDate: true,
          },
        });
        if (order) {
          await this.chat.postQuoteOrderCard({ consumerId, shopId: target.shopId, order });
        }
      } catch (e) {
        LoggerUtil.log(
          `[QuoteReservation] 채팅 예약 카드 실패 request=${r.id}: ${e instanceof Error ? e.message : e}`,
        );
        SentryUtil.captureException(e, "warning", { module: "quote", operation: "reserve-card" });
      }
    }
    return { orderId: created.id };
  }
}
