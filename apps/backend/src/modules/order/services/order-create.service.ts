import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import {
  Prisma,
  OrderStatus as DbOrderStatus,
} from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import {
  CreateOrderRequestDto,
  CreateOrderResponseDto,
} from "@apps/backend/modules/order/dto/order-create.dto";
import {
  ORDER_ERROR_MESSAGES,
  OrderStatus,
} from "@apps/backend/modules/order/constants/order.constants";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { EnableStatus } from "@apps/backend/modules/product/constants/product.constants";
import { OrderLifecycleHookService } from "@apps/backend/modules/order/services/order-lifecycle-hook.service";
import { ORDER_STATUS_TRANSITION_SOURCE } from "@apps/backend/modules/order/types/order-lifecycle.types";
import {
  assertProductOptionsVersion,
  buildOrderItemNormalizeContext,
  validateAndNormalizeOrderItem,
} from "@apps/backend/modules/order/utils/order-item-normalize.util";
import { isPickupAllowedForStore } from "@apps/backend/modules/order/utils/order-store-business-calendar.util";
import {
  koreaCalendarDayEndUtc,
  koreaCalendarDayStartUtc,
  koreaCalendarYmd,
} from "@apps/backend/modules/order/utils/order-list-query.util";

/**
 * 주문 생성 서비스
 * 주문 생성 관련 로직을 담당합니다.
 */
@Injectable()
export class OrderCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderLifecycleHookService: OrderLifecycleHookService,
  ) {}

  /**
   * 주문 생성 (사용자용)
   * @param userId - 사용자 ID
   * @param createOrderDto - 주문 생성 요청 DTO
   * @returns 생성된 주문 ID
   */
  async createOrderForUser(
    userId: string,
    createOrderDto: CreateOrderRequestDto,
  ): Promise<CreateOrderResponseDto> {
    const {
      productId,
      productName,
      productImages,
      items,
      totalQuantity,
      totalPrice,
      storeName,
      pickupDate,
      pickupAddress,
      pickupRoadAddress,
      pickupDetailAddress = "",
      pickupZonecode,
      pickupLatitude,
      pickupLongitude,
      reservationContactName,
      reservationPhone,
      entrySource,
    } = createOrderDto;

    // 상품 존재 여부 및 판매 가능 여부 확인
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        store: true,
      },
    });

    if (!product) {
      LoggerUtil.log(
        `주문 생성 실패: 상품을 찾을 수 없음 - productId: ${productId}, userId: ${userId}`,
      );
      throw new NotFoundException(ORDER_ERROR_MESSAGES.PRODUCT_NOT_FOUND);
    }

    if (product.salesStatus !== EnableStatus.ENABLE) {
      LoggerUtil.log(
        `주문 생성 실패: 상품 판매 비활성화 - productId: ${productId}, userId: ${userId}, salesStatus: ${product.salesStatus}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PRODUCT_INACTIVE);
    }

    if (product.visibilityStatus !== EnableStatus.ENABLE) {
      LoggerUtil.log(
        `주문 생성 실패: 상품 비공개 상태 - productId: ${productId}, userId: ${userId}, visibilityStatus: ${product.visibilityStatus}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PRODUCT_NOT_AVAILABLE);
    }

    // 주문 항목 검증
    if (!items || items.length === 0) {
      LoggerUtil.log(`주문 생성 실패: 주문 항목 없음 - productId: ${productId}, userId: ${userId}`);
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
    }

    // 총 수량 검증
    const calculatedTotalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (calculatedTotalQuantity !== totalQuantity) {
      LoggerUtil.log(
        `주문 생성 실패: 총 수량 불일치 - productId: ${productId}, userId: ${userId}, calculated: ${calculatedTotalQuantity}, provided: ${totalQuantity}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_TOTAL_QUANTITY);
    }

    // 구매자가 옵션을 고르는 사이 판매자가 옵션을 바꿨으면 거절 (이름만 바뀐 경우까지 잡기 위해 버전 비교)
    assertProductOptionsVersion(createOrderDto.productOptionsVersion, product.optionsVersion);

    const normalizeContext = buildOrderItemNormalizeContext(product);
    const normalizedItems = items.map((item) =>
      validateAndNormalizeOrderItem(item, normalizeContext),
    );

    // 총 금액 검증 (서버 기준 옵션 가격으로 계산)
    const calculatedTotalPrice = normalizedItems.reduce(
      (sum, item) => sum + item.itemPrice * item.quantity,
      0,
    );

    if (calculatedTotalPrice !== totalPrice) {
      LoggerUtil.log(
        `주문 생성 실패: 총 금액 불일치 - productId: ${productId}, userId: ${userId}, calculated: ${calculatedTotalPrice}, provided: ${totalPrice}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_TOTAL_PRICE);
    }

    const pickupAt = new Date(pickupDate);
    if (!isPickupAllowedForStore(pickupAt, product.store)) {
      LoggerUtil.log(
        `주문 생성 실패: 픽업 일시가 스토어 영업 시간 밖 - productId: ${productId}, userId: ${userId}, pickupDate: ${pickupDate}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PICKUP_OUTSIDE_STORE_BUSINESS_HOURS);
    }

    // 주문 생성 (트랜잭션)
    // 주문 번호 중복 방지를 위해 최대 10회 재시도
    const maxRetries = 10;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const created = await this.prisma.$transaction(
          async (tx) => {
            // 주문 번호 생성 (예: ORD-20240101-001). 날짜·순번은 한국 날짜 기준(전에는 UTC라 아침 9시 전 주문이 어제 날짜)
            const now = new Date();
            const ymd = koreaCalendarYmd(now);
            const dateStr = ymd.replace(/-/g, "");

            const startOfDay = koreaCalendarDayStartUtc(ymd);
            const endOfDay = koreaCalendarDayEndUtc(ymd);

            const todayOrderCount = await tx.order.count({
              where: {
                createdAt: {
                  gte: startOfDay,
                  lte: endOfDay,
                },
              },
            });

            // 재시도 시 sequence에 retryCount를 더하여 중복 방지
            const sequence = String(todayOrderCount + 1 + retryCount).padStart(3, "0");
            const orderNumber = `ORD-${dateStr}-${sequence}`;

            // 모든 상품: 예약신청 → 판매자 확인 후 입금대기
            const orderStatus = OrderStatus.RESERVATION_REQUESTED;

            const order = await tx.order.create({
              data: {
                consumerId: userId,
                productId,
                productName,
                productImages,
                storeId: product.storeId,
                storeName,
                orderNumber,
                totalQuantity,
                totalPrice,
                pickupDate: new Date(pickupDate),
                pickupAddress,
                pickupRoadAddress,
                pickupDetailAddress,
                pickupZonecode,
                pickupLatitude,
                pickupLongitude,
                reservationContactName: reservationContactName ?? null,
                reservationPhone: reservationPhone ?? null,
                entrySource: entrySource ?? null,
                orderStatus,
                orderItems: {
                  create: normalizedItems,
                },
              },
              include: {
                orderItems: true,
              },
            });

            // 주문 ID만 반환
            return { id: order.id };
          },
          {
            maxWait: 5000, // 최대 대기 시간 (5초)
            timeout: 10000, // 타임아웃 (10초)
          },
        );

        // 주문 생성 후 상태 전환 후처리
        this.orderLifecycleHookService.afterOrderStatusTransition({
          orderId: created.id,
          fromStatus: null,
          toStatus: OrderStatus.RESERVATION_REQUESTED,
          source: ORDER_STATUS_TRANSITION_SOURCE.ORDER_CREATE,
        });

        return created;
      } catch (error: any) {
        // 주문 번호 중복 에러인 경우 재시도
        if (error?.code === "P2002") {
          const rawTarget = error?.meta?.target;
          const targetText = Array.isArray(rawTarget)
            ? rawTarget.join(",")
            : String(rawTarget ?? "");
          const isOrderNumberConflict =
            targetText.includes("order_number") || targetText.includes("orderNumber");

          if (!rawTarget || isOrderNumberConflict) {
            retryCount++;
            if (retryCount >= maxRetries) {
              LoggerUtil.log(
                `주문 생성 최종 실패: 재시도 횟수 초과 - userId: ${userId}, productId: ${productId}, retryCount: ${retryCount}, maxRetries: ${maxRetries}`,
              );
              throw new BadRequestException(ORDER_ERROR_MESSAGES.ORDER_CREATE_FAILED);
            }
            LoggerUtil.log(
              `주문 생성 재시도: 주문 번호 중복 - userId: ${userId}, productId: ${productId}, retryCount: ${retryCount}/${maxRetries}`,
            );
            // 짧은 지연 후 재시도
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }
        }
        // 다른 에러는 로그 남기고 throw
        LoggerUtil.log(
          `주문 생성 실패: 트랜잭션 에러 - userId: ${userId}, productId: ${productId}, error: ${error?.message || String(error)}`,
        );
        throw error;
      }
    }

    LoggerUtil.log(
      `주문 생성 최종 실패: 재시도 루프 종료 - userId: ${userId}, productId: ${productId}, maxRetries: ${maxRetries}`,
    );
    throw new BadRequestException(ORDER_ERROR_MESSAGES.ORDER_CREATE_FAILED);
  }

  /**
   * 견적으로 예약 만들기(기획 I-01): 입점 가게 견적을 고른 손님이 "이 견적으로 예약하기".
   * 상품 예약과 같이 예약신청으로 만들고, 이후(사장님 예약 확인 → 입금대기 …)는 지금 흐름 그대로다.
   * 상품·옵션 없이 견적 금액과 요청서 요약을 주문에 남긴다. 같은 견적에 살아 있는 예약이 있으면 막는다.
   */
  async createOrderFromQuote(input: {
    consumerId: string;
    storeId: string;
    quoteId: string;
    productName: string;
    productImages: string[];
    totalQuantity: number;
    totalPrice: number;
    pickupAt: Date;
    reservationContactName: string | null;
    reservationPhone: string | null;
    activeStatuses: readonly DbOrderStatus[];
  }): Promise<{ id: string }> {
    const store = await this.prisma.store.findUnique({
      where: { id: input.storeId },
      select: {
        name: true,
        address: true,
        roadAddress: true,
        detailAddress: true,
        zonecode: true,
        latitude: true,
        longitude: true,
        weeklyClosedWeekdays: true,
        standardOpenTime: true,
        standardCloseTime: true,
        businessCalendarOverrides: true,
      },
    });
    if (!store) throw new NotFoundException(ORDER_ERROR_MESSAGES.STORE_NOT_FOUND);
    if (input.pickupAt.getTime() <= Date.now()) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PICKUP_IN_PAST);
    }
    if (!isPickupAllowedForStore(input.pickupAt, store)) {
      throw new BadRequestException(ORDER_ERROR_MESSAGES.PICKUP_OUTSIDE_STORE_BUSINESS_HOURS);
    }

    const data: Omit<Prisma.OrderUncheckedCreateInput, "orderNumber"> = {
      consumerId: input.consumerId,
      productId: null,
      quoteId: input.quoteId,
      productName: input.productName,
      productImages: input.productImages,
      storeId: input.storeId,
      storeName: store.name,
      totalQuantity: input.totalQuantity,
      totalPrice: input.totalPrice,
      pickupDate: input.pickupAt,
      pickupAddress: store.address,
      pickupRoadAddress: store.roadAddress,
      pickupDetailAddress: store.detailAddress ?? "",
      pickupZonecode: store.zonecode,
      pickupLatitude: store.latitude,
      pickupLongitude: store.longitude,
      reservationContactName: input.reservationContactName,
      reservationPhone: input.reservationPhone,
      orderStatus: OrderStatus.RESERVATION_REQUESTED,
    };

    for (let retry = 0; retry < 10; retry++) {
      try {
        const created = await this.prisma.$transaction(
          async (tx) => {
            // 두 번 눌러도 예약은 하나만(견적 줄을 잠그고 살아 있는 예약이 있는지 본다)
            await tx.$queryRaw`SELECT id FROM quotes WHERE id = ${input.quoteId} FOR UPDATE`;
            const existing = await tx.order.count({
              where: { quoteId: input.quoteId, orderStatus: { in: [...input.activeStatuses] } },
            });
            if (existing > 0)
              throw new ConflictException(ORDER_ERROR_MESSAGES.QUOTE_ALREADY_RESERVED);
            const ymd = koreaCalendarYmd(new Date());
            const todayOrderCount = await tx.order.count({
              where: {
                createdAt: { gte: koreaCalendarDayStartUtc(ymd), lte: koreaCalendarDayEndUtc(ymd) },
              },
            });
            const sequence = String(todayOrderCount + 1 + retry).padStart(3, "0");
            const order = await tx.order.create({
              data: { ...data, orderNumber: `ORD-${ymd.replace(/-/g, "")}-${sequence}` },
              select: { id: true },
            });
            return { id: order.id };
          },
          { maxWait: 5000, timeout: 10000 },
        );
        this.orderLifecycleHookService.afterOrderStatusTransition({
          orderId: created.id,
          fromStatus: null,
          toStatus: OrderStatus.RESERVATION_REQUESTED,
          source: ORDER_STATUS_TRANSITION_SOURCE.ORDER_CREATE,
        });
        return created;
      } catch (error: unknown) {
        const e = error as { code?: string; meta?: { target?: unknown } };
        const target = Array.isArray(e?.meta?.target)
          ? (e.meta!.target as string[]).join(",")
          : String(e?.meta?.target ?? "");
        if (e?.code === "P2002" && (!target || target.includes("order_number"))) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }
        throw error;
      }
    }
    throw new BadRequestException(ORDER_ERROR_MESSAGES.ORDER_CREATE_FAILED);
  }
}
