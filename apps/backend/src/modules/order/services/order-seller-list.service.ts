import { Injectable, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import {
  OrderListResponseDto,
  OrderListRequestDto,
} from "@apps/backend/modules/order/dto/order-list.dto";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { OrderMapperUtil } from "@apps/backend/modules/order/utils/order-mapper.util";
import {
  buildOrderOrderBy,
  buildOrderKeywordCondition,
  mergeOrderPickupDateConditions,
  createdAtRangeFilter,
} from "@apps/backend/modules/order/utils/order-list-query.util";
import { calculatePaginationMeta } from "@apps/backend/common/utils/pagination.util";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { OrderResponseDto } from "@apps/backend/modules/order/dto/order-detail.dto";
import { ORDER_ERROR_MESSAGES } from "@apps/backend/modules/order/constants/order.constants";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { OrderAutomationService } from "@apps/backend/modules/order/services/order-automation.service";

/**
 * 판매자용 주문 목록 조회 서비스
 * (`OrderUserListService`와 대응)
 */
@Injectable()
export class OrderSellerListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderAutomationService: OrderAutomationService,
  ) {}

  /**
   * 판매자용 주문 목록 조회
   * 자신이 소유한 스토어의 주문만 조회합니다.
   */
  async getOrdersForSeller(
    query: OrderListRequestDto,
    user: JwtVerifiedPayload,
  ): Promise<OrderListResponseDto> {
    const {
      page,
      limit,
      sortBy,
      storeId,
      orderStatus,
      startDate,
      endDate,
      orderNumber,
      productName,
      keyword,
      type,
      pickupStartDate,
      pickupEndDate,
    } = query;

    // 사용자가 소유한 스토어 목록 조회
    const userStores = await this.prisma.store.findMany({
      where: {
        sellerId: user.sub,
      },
      select: {
        id: true,
      },
    });

    const userStoreIds = userStores.map((store) => store.id);

    if (userStoreIds.length === 0) {
      return {
        data: [],
        meta: calculatePaginationMeta(page, limit, 0),
      };
    }

    // WHERE 조건 구성
    const where: Prisma.OrderWhereInput = {
      storeId: {
        in: userStoreIds,
      },
    };

    // 스토어 필터
    if (storeId) {
      if (!userStoreIds.includes(storeId)) {
        LoggerUtil.log(
          `주문 목록 조회 실패: 스토어 소유권 없음 - userId: ${user.sub}, storeId: ${storeId}`,
        );
        throw new ForbiddenException(ORDER_ERROR_MESSAGES.STORE_NOT_OWNED);
      }
      where.storeId = storeId;
    }

    // 주문 상태 필터
    if (orderStatus) {
      where.orderStatus = orderStatus;
    }

    // 날짜 필터(주문일, 한국 달력 하루)
    const createdAtRange = createdAtRangeFilter(startDate, endDate);
    if (createdAtRange) {
      where.createdAt = createdAtRange;
    }

    // 주문 번호 검색
    if (orderNumber) {
      where.orderNumber = {
        contains: orderNumber,
      };
    }

    // 상품명 검색
    if (productName) {
      where.productName = {
        contains: productName,
      };
    }

    // 검색어 하나로 주문번호·상품명·예약자 이름·연락처 찾기(판매자 앱 주문 찾기)
    const keywordCondition = buildOrderKeywordCondition(keyword);
    if (keywordCondition) {
      const existing = where.AND;
      const prefix = Array.isArray(existing) ? existing : existing ? [existing] : [];
      where.AND = [...prefix, keywordCondition];
    }

    mergeOrderPickupDateConditions(where, {
      type,
      pickupStartDate,
      pickupEndDate,
    });

    const totalItems = await this.prisma.order.count({ where });
    const orderBy = buildOrderOrderBy(sortBy);

    // 페이지네이션
    const skip = (page - 1) * limit;

    const listFindArgs = {
      where,
      orderBy,
      skip,
      take: limit,
      include: OrderMapperUtil.ORDER_ITEMS_INCLUDE,
    } satisfies Prisma.OrderFindManyArgs;

    let orders = await this.prisma.order.findMany(listFindArgs);
    // 상태가 바뀐 주문이 있을 때만 다시 읽는다(전에는 주문마다 한 번씩 읽고 목록도 늘 다시 읽음)
    if (await this.orderAutomationService.syncLoadedOrders(orders)) {
      orders = await this.prisma.order.findMany(listFindArgs);
    }

    // DTO로 변환
    const data: OrderResponseDto[] = orders.map((order) =>
      OrderMapperUtil.mapToOrderResponse(order),
    );

    const meta = calculatePaginationMeta(page, limit, totalItems);

    return { data, meta };
  }
}
