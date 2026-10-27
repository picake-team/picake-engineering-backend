import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import {
  ORDER_ERROR_MESSAGES,
  OrderStatus,
} from "@apps/backend/modules/order/constants/order.constants";
import { EnableStatus } from "@apps/backend/modules/product/constants/product.constants";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { OrderOwnershipUtil } from "@apps/backend/modules/order/utils/order-ownership.util";
import { OrderAutomationService } from "@apps/backend/modules/order/services/order-automation.service";
import { RESERVATION_USER_EDIT_ALLOWED_STATUSES } from "@apps/backend/modules/order/utils/order-status-transition.util";
import {
  assertProductOptionsVersion,
  buildOrderItemNormalizeContext,
  validateAndNormalizeOrderItem,
} from "@apps/backend/modules/order/utils/order-item-normalize.util";
import {
  UpdateReservationOrderItemRequestDto,
  UpdateReservationOrderItemsRequestDto,
  UpdateReservationPickupDateRequestDto,
} from "@apps/backend/modules/order/dto/order-user-reservation-edit.dto";
import { isPickupAllowedForStore } from "@apps/backend/modules/order/utils/order-store-business-calendar.util";

/**
 * 예약신청(RESERVATION_REQUESTED) 단계에서만 허용되는 주문 수정 (픽업일·주문 항목).
 */
@Injectable()
export class OrderUserReservationEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderAutomationService: OrderAutomationService,
  ) {}

  async updatePickupDate(
    orderId: string,
    userId: string,
    dto: UpdateReservationPickupDateRequestDto,
  ): Promise<{ id: string }> {
    await OrderOwnershipUtil.verifyOrderUserOwnership(this.prisma, orderId, userId);
    await this.orderAutomationService.syncOrderLifecycleById(orderId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true, storeId: true },
    });
    if (!order) {
      throw new NotFoundException(ORDER_ERROR_MESSAGES.NOT_FOUND);
    }

    const status = order.orderStatus as OrderStatus;
    if (!RESERVATION_USER_EDIT_ALLOWED_STATUSES.has(status)) {
      LoggerUtil.log(`예약 픽업일 변경 실패: 상태 불가 - orderId: ${orderId}, status: ${status}`);
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_USER_ORDER_ACTION);
    }

    const store = await this.prisma.store.findUnique({
      where: { id: order.storeId },
      select: {
        weeklyClosedWeekdays: true,
        standardOpenTime: true,
        standardCloseTime: true,
        businessCalendarOverrides: true,
      },
    });
    if (!store) {
      throw new NotFoundException(ORDER_ERROR_MESSAGES.STORE_NOT_FOUND);
    }

    const pickupAt = new Date(dto.pickupDate);
    if (!isPickupAllowedForStore(pickupAt, store)) {
      LoggerUtil.log(
        `예약 픽업일 변경 실패: 영업 시간 밖 - orderId: ${orderId}, pickupDate: ${dto.pickupDate}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PICKUP_OUTSIDE_STORE_BUSINESS_HOURS);
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { pickupDate: new Date(dto.pickupDate) },
    });
    return { id: orderId };
  }

  /**
   * [레거시] 주문 항목 전체 교체 — 구버전 web-user용. 정리 단계에서 삭제합니다.
   */
  async updateOrderItems(
    orderId: string,
    userId: string,
    dto: UpdateReservationOrderItemsRequestDto,
  ): Promise<{ id: string }> {
    const { product } = await this.loadEditableReservation(orderId, userId, "주문 항목 변경");

    const { items, totalQuantity, totalPrice } = dto;
    if (!items?.length) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
    }

    const calculatedTotalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (calculatedTotalQuantity !== totalQuantity) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_TOTAL_QUANTITY);
    }

    const normalizeContext = buildOrderItemNormalizeContext(product);
    const normalizedItems = items.map((item) =>
      validateAndNormalizeOrderItem(item, normalizeContext),
    );

    const calculatedTotalPrice = normalizedItems.reduce(
      (sum, item) => sum + item.itemPrice * item.quantity,
      0,
    );
    if (calculatedTotalPrice !== totalPrice) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_TOTAL_PRICE);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.update({
        where: { id: orderId },
        data: {
          totalQuantity,
          totalPrice,
          orderItems: { create: normalizedItems },
        },
      });
    });

    return { id: orderId };
  }

  /**
   * 주문 항목 1개의 옵션 변경.
   * 변경한 항목만 상품의 현재 옵션으로 검증하고, 나머지 항목은 저장된 옵션·금액을 그대로 둡니다.
   * (판매자가 다른 항목의 옵션을 숨기거나 가격을 바꿔도 이 변경이 막히거나 다른 항목 금액이 바뀌지 않음)
   */
  async updateOrderItem(
    orderId: string,
    itemId: string,
    userId: string,
    dto: UpdateReservationOrderItemRequestDto,
  ): Promise<{ id: string }> {
    const { order, product } = await this.loadEditableReservation(
      orderId,
      userId,
      "주문 항목 단건 변경",
    );

    const target = order.orderItems.find((orderItem) => orderItem.id === itemId);
    if (!target) {
      LoggerUtil.log(
        `예약 주문 항목 단건 변경 실패: 항목 없음 - orderId: ${orderId}, itemId: ${itemId}`,
      );
      throw new NotFoundException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
    }

    const { totalPrice, productOptionsVersion, ...item } = dto;
    assertProductOptionsVersion(productOptionsVersion, product.optionsVersion);

    const normalizedItem = validateAndNormalizeOrderItem(
      item,
      buildOrderItemNormalizeContext(product),
    );

    const otherItems = order.orderItems.filter((orderItem) => orderItem.id !== itemId);
    const calculatedTotalPrice =
      otherItems.reduce((sum, orderItem) => sum + orderItem.itemPrice * orderItem.quantity, 0) +
      normalizedItem.itemPrice * normalizedItem.quantity;
    if (calculatedTotalPrice !== totalPrice) {
      LoggerUtil.log(
        `예약 주문 항목 단건 변경 실패: 총 금액 불일치 - orderId: ${orderId}, calculated: ${calculatedTotalPrice}, provided: ${totalPrice}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_TOTAL_PRICE);
    }
    const calculatedTotalQuantity =
      otherItems.reduce((sum, orderItem) => sum + orderItem.quantity, 0) + normalizedItem.quantity;

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({ where: { id: itemId }, data: normalizedItem });
      await tx.order.update({
        where: { id: orderId },
        data: { totalQuantity: calculatedTotalQuantity, totalPrice: calculatedTotalPrice },
      });
    });

    return { id: orderId };
  }

  /**
   * 예약신청 단계 주문 수정 공통 확인: 소유권·상태·픽업 일시·상품 판매 가능 여부
   */
  private async loadEditableReservation(orderId: string, userId: string, logLabel: string) {
    await OrderOwnershipUtil.verifyOrderUserOwnership(this.prisma, orderId, userId);
    await this.orderAutomationService.syncOrderLifecycleById(orderId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderStatus: true,
        productId: true,
        storeId: true,
        pickupDate: true,
        orderItems: { select: { id: true, itemPrice: true, quantity: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(ORDER_ERROR_MESSAGES.NOT_FOUND);
    }

    const status = order.orderStatus as OrderStatus;
    if (!RESERVATION_USER_EDIT_ALLOWED_STATUSES.has(status)) {
      LoggerUtil.log(`예약 ${logLabel} 실패: 상태 불가 - orderId: ${orderId}, status: ${status}`);
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_USER_ORDER_ACTION);
    }

    const store = await this.prisma.store.findUnique({
      where: { id: order.storeId },
      select: {
        weeklyClosedWeekdays: true,
        standardOpenTime: true,
        standardCloseTime: true,
        businessCalendarOverrides: true,
      },
    });
    if (!store) {
      throw new NotFoundException(ORDER_ERROR_MESSAGES.STORE_NOT_FOUND);
    }

    if (order.pickupDate && !isPickupAllowedForStore(order.pickupDate, store)) {
      LoggerUtil.log(`예약 ${logLabel} 실패: 기존 픽업 일시가 영업 시간 밖 - orderId: ${orderId}`);
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PICKUP_OUTSIDE_STORE_BUSINESS_HOURS);
    }

    const product = await this.prisma.product.findUnique({
      where: { id: order.productId },
    });
    if (!product) {
      throw new NotFoundException(ORDER_ERROR_MESSAGES.PRODUCT_NOT_FOUND);
    }
    if (product.storeId !== order.storeId) {
      LoggerUtil.log(
        `예약 ${logLabel} 실패: 스토어 불일치 - orderId: ${orderId}, orderStore: ${order.storeId}, productStore: ${product.storeId}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
    }
    if (product.salesStatus !== EnableStatus.ENABLE) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PRODUCT_INACTIVE);
    }
    if (product.visibilityStatus !== EnableStatus.ENABLE) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PRODUCT_NOT_AVAILABLE);
    }

    return { order, product };
  }
}
