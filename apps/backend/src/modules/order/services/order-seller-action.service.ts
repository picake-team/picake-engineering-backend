import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { UpdateOrderStatusRequestDto } from "../dto/order-seller-action.dto";
import {
  OrderStatus,
  ORDER_ERROR_MESSAGES,
} from "@apps/backend/modules/order/constants/order.constants";
import { OrderOwnershipUtil } from "@apps/backend/modules/order/utils/order-ownership.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import {
  isSellerTransitionAllowed,
  withCanceledAt,
} from "@apps/backend/modules/order/utils/order-status-transition.util";
import { OrderAutomationService } from "@apps/backend/modules/order/services/order-automation.service";
import { OrderLifecycleHookService } from "@apps/backend/modules/order/services/order-lifecycle-hook.service";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import {
  computePaymentPendingDeadline,
  PICKUP_REMINDER_LEAD_MS,
} from "@apps/backend/modules/order/utils/order-datetime.util";

/**
 * 판매자(스토어 소유자) 주문 액션 전용 서비스.
 * `OrderUserActionService`와 대응됩니다.
 */
@Injectable()
export class OrderSellerActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderAutomationService: OrderAutomationService,
    private readonly orderLifecycleHookService: OrderLifecycleHookService,
  ) {}

  /**
   * 주문 상태 변경 (판매자용)
   * 자신이 소유한 스토어의 주문만 상태 변경 가능합니다.
   *
   * 입금대기(예약 확인)·예약확정·픽업완료·노쇼·취소완료·취소환불대기·취소환불완료 중 하나입니다.
   * isSellerTransitionAllowed 규칙을 따릅니다.
   *
   * @param orderId - 주문 ID
   * @param updateDto - 상태 변경 요청 DTO
   * @param userId - 사용자 ID (권한 확인용)
   * @returns 업데이트된 주문 ID
   */
  async updateOrderStatusForSeller(
    orderId: string,
    updateDto: UpdateOrderStatusRequestDto,
    userId: string,
  ): Promise<{ id: string }> {
    await OrderOwnershipUtil.verifyOrderStoreOwnership(this.prisma, orderId, userId, {
      id: true,
      sellerId: true,
    });

    await this.orderAutomationService.syncOrderLifecycleById(orderId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true, pickupDate: true },
    });

    if (!order) {
      throw new NotFoundException(ORDER_ERROR_MESSAGES.NOT_FOUND);
    }

    const { orderStatus } = updateDto;
    const current = order.orderStatus as OrderStatus;

    if (current === orderStatus) {
      LoggerUtil.log(
        `주문 상태 변경 실패: 동일한 상태 - orderId: ${orderId}, userId: ${userId}, currentStatus: ${current}, requestedStatus: ${orderStatus}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.SAME_STATUS);
    }

    if (!isSellerTransitionAllowed(current, orderStatus)) {
      LoggerUtil.log(
        `주문 상태 변경 실패: 허용되지 않은 전환 - orderId: ${orderId}, userId: ${userId}, from: ${current}, to: ${orderStatus}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_STATUS_TRANSITION);
    }

    // 픽업 시간이 지난 예약을 확인하면 입금 마감이 곧 픽업 시각(이미 지남)이라, 입금 안내 직후 자동 취소 안내가 또 간다
    if (
      orderStatus === OrderStatus.PAYMENT_PENDING &&
      order.pickupDate &&
      order.pickupDate.getTime() <= Date.now()
    ) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PICKUP_PASSED_CANNOT_CONFIRM);
    }

    if (orderStatus === OrderStatus.CANCEL_COMPLETED) {
      const reason = updateDto.sellerCancelReason?.trim();
      if (!reason) {
        throw new BadRequestException(ORDER_ERROR_MESSAGES.SELLER_CANCEL_REASON_REQUIRED);
      }
    }

    if (orderStatus === OrderStatus.NO_SHOW) {
      const reason = updateDto.sellerNoShowReason?.trim();
      if (!reason) {
        throw new BadRequestException(ORDER_ERROR_MESSAGES.SELLER_NO_SHOW_REASON_REQUIRED);
      }
    }

    if (orderStatus === OrderStatus.CANCEL_REFUND_PENDING) {
      const reason = updateDto.sellerCancelRefundPendingReason?.trim();
      if (!reason) {
        throw new BadRequestException(
          ORDER_ERROR_MESSAGES.SELLER_CANCEL_REFUND_PENDING_REASON_REQUIRED,
        );
      }
    }

    const data: Prisma.OrderUpdateManyMutationInput = { orderStatus };
    if (orderStatus === OrderStatus.PAYMENT_PENDING) {
      const at = new Date();
      data.paymentPendingAt = at;
      data.paymentPendingDeadlineAt = computePaymentPendingDeadline(at, order.pickupDate);
    }
    // 예약 확정 알림톡(M-03)은 "픽업까지 하루 넘게 남았다면 픽업 전날 안내"라고 한다. 하루가 안 남은 확정이면
    // 전날 안내(M-04 "내일 픽업이에요")를 보내지 않게 보낸 것으로 표시한다(확정 직후 같은 날 '내일'이 가던 것)
    if (
      orderStatus === OrderStatus.CONFIRMED &&
      order.pickupDate &&
      order.pickupDate.getTime() - Date.now() < PICKUP_REMINDER_LEAD_MS
    ) {
      data.pickupReminderSentAt = new Date();
    }
    if (orderStatus === OrderStatus.CANCEL_COMPLETED && updateDto.sellerCancelReason) {
      data.sellerCancelReason = updateDto.sellerCancelReason.trim();
    }
    if (orderStatus === OrderStatus.NO_SHOW && updateDto.sellerNoShowReason) {
      data.sellerNoShowReason = updateDto.sellerNoShowReason.trim();
    }
    if (
      orderStatus === OrderStatus.CANCEL_REFUND_PENDING &&
      updateDto.sellerCancelRefundPendingReason
    ) {
      data.sellerCancelRefundPendingReason = updateDto.sellerCancelRefundPendingReason.trim();
    }

    // 읽은 상태 그대로일 때만 바꾼다. 그사이 손님·다른 기기·자동 작업(입금 마감 취소 등)이 먼저 바꿨으면
    // 덮어쓰지 않는다(취소된 주문이 되살아나거나 알림이 두 번 가는 것). 사장님 앱은 이 말을
    // "그사이 주문 상태가 바뀌어 처리하지 못했어요"로 보여 준다(web-seller useOrderMutation)
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, orderStatus: current },
      data: withCanceledAt(current, data),
    });
    if (count === 0) {
      LoggerUtil.log(
        `주문 상태 변경 실패: 그사이 상태가 바뀜 - orderId: ${orderId}, userId: ${userId}, from: ${current}, to: ${orderStatus}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_STATUS_TRANSITION);
    }

    this.orderLifecycleHookService.afterOrderStatusTransition({
      orderId,
      fromStatus: current,
      toStatus: orderStatus,
      source: ORDER_STATUS_TRANSITION_SOURCE.SELLER_STATUS_UPDATE,
    });

    return { id: orderId };
  }
}
