import { Order, OrderItem } from "@apps/backend/infra/database/prisma/generated/client";
import {
  OrderItemResponseDto,
  OrderResponseDto,
  SelectedOptionResponseDto,
} from "@apps/backend/modules/order/dto/order-detail.dto";
import {
  OrderMyReviewUiStatus,
  OrderStatus,
} from "@apps/backend/modules/order/constants/order.constants";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { refundCancellationPolicyFromDb } from "@apps/backend/modules/store/utils/store-refund-cancellation-policy.util";
import { QUOTE_SIMILARITY_LABELS } from "@apps/backend/modules/quote-request/constants/quote.constants";

/** 주문 응답에 실을 스토어 연락·정산·환불 규정 select (후기 등 동일 include와 공유) */
export const ORDER_RESPONSE_STORE_SELECT = {
  bankAccountNumber: true,
  bankName: true,
  accountHolderName: true,
  phoneNumber: true,
  kakaoChannelId: true,
  instagramId: true,
  refundCancellationPolicy: true,
} as const satisfies Prisma.StoreSelect;

/**
 * Prisma Order 엔티티 타입 (orderItems·연결 후기 id 포함)
 */
/** 견적으로 만든 예약(기획 I-01)의 견적·요청서 */
export const ORDER_QUOTE_SELECT = {
  memo: true,
  photoUrls: true,
  similarity: true,
  quoteRequest: {
    select: { id: true, description: true, requestNote: true, photoUrls: true },
  },
} as const satisfies Prisma.QuoteSelect;

type OrderWithItems = Order & {
  orderItems: OrderItem[];
  review: { id: string; deletedAt: Date | null } | null;
  store: Prisma.StoreGetPayload<{ select: typeof ORDER_RESPONSE_STORE_SELECT }>;
  quote?: Prisma.QuoteGetPayload<{ select: typeof ORDER_QUOTE_SELECT }> | null;
};

/** 손님이 쓴 요청서 글·사진은 픽업 24시간 뒤까지만 가게에 보인다(처리방침 제3조 ②, 견적 P-75와 같게) */
const QUOTE_CONTENT_HOURS_AFTER_PICKUP = 24;

/**
 * 주문 매핑 유틸리티
 * Prisma Order 및 OrderItem 엔티티를 응답 DTO로 변환하는 공통 로직을 제공합니다.
 */
export class OrderMapperUtil {
  /**
   * OrderItems select 필드
   * 주문 조회 시 orderItems를 포함하기 위한 공통 include 필드
   * (productName, productImages는 Order에 denormalized 저장됨)
   */
  static readonly ORDER_ITEMS_INCLUDE = {
    orderItems: true,
    review: {
      select: { id: true, deletedAt: true },
    },
    store: {
      select: ORDER_RESPONSE_STORE_SELECT,
    },
    quote: { select: ORDER_QUOTE_SELECT },
  } as const satisfies Prisma.OrderInclude;

  /**
   * 주문 상태·연결 후기(소프트 삭제 포함)로 사용자 후기 UI 상태 계산
   */
  static reviewUiFromOrder(
    order: Pick<Order, "orderStatus" | "productId"> & {
      review: { id: string; deletedAt: Date | null } | null;
    },
  ): Pick<OrderResponseDto, "myReviewUiStatus" | "linkedProductReviewId"> {
    // 견적으로 만든 예약은 상품이 없어 후기를 받지 않는다(운영자 결정 11-13)
    if (order.orderStatus !== OrderStatus.PICKUP_COMPLETED || !order.productId) {
      return {
        myReviewUiStatus: OrderMyReviewUiStatus.NOT_AVAILABLE,
        linkedProductReviewId: null,
      };
    }
    if (order.review) {
      if (order.review.deletedAt != null) {
        return {
          myReviewUiStatus: OrderMyReviewUiStatus.WITHDRAWN,
          linkedProductReviewId: null,
        };
      }
      return {
        myReviewUiStatus: OrderMyReviewUiStatus.WRITTEN,
        linkedProductReviewId: order.review.id,
      };
    }
    return {
      myReviewUiStatus: OrderMyReviewUiStatus.WRITABLE,
      linkedProductReviewId: null,
    };
  }

  /**
   * Prisma OrderItem 엔티티를 OrderItemResponseDto로 변환
   * @param orderItem - Prisma OrderItem 엔티티
   * @returns OrderItemResponseDto 객체
   */

  static mapToOrderItemResponse(orderItem: OrderItem): OrderItemResponseDto {
    return {
      id: orderItem.id,
      // 사이즈 옵션 정보
      sizeId: orderItem.sizeId ?? undefined,
      sizeDisplayName: orderItem.sizeDisplayName ?? undefined,
      sizeLengthCm: orderItem.sizeLengthCm ?? undefined,
      sizeDescription: orderItem.sizeDescription ?? undefined,
      sizePrice: orderItem.sizePrice ?? undefined,
      // 맛 옵션 정보
      // 추가 옵션 (주문 시점 스냅샷)
      selectedOptions: Array.isArray(orderItem.selectedOptions)
        ? (orderItem.selectedOptions as unknown as SelectedOptionResponseDto[])
        : [],
      optionsPrice: orderItem.optionsPrice,
      // 기타 옵션
      letteringMessage: orderItem.letteringMessage ?? undefined,
      requestMessage: orderItem.requestMessage ?? undefined,
      quantity: orderItem.quantity,
      itemPrice: orderItem.itemPrice,
      imageUrls: orderItem.imageUrls,
      createdAt: orderItem.createdAt,
      updatedAt: orderItem.updatedAt,
    } satisfies OrderItemResponseDto;
  }

  /**
   * Prisma Order 엔티티를 OrderResponseDto로 변환
   * @param order - Prisma Order 엔티티 (orderItems 포함)
   * @returns OrderResponseDto 객체
   */
  /** 견적 예약의 견적·요청서(상품 예약은 null). 요청서 글·사진은 픽업 24시간 뒤에는 가린다 */
  static quoteInfo(order: OrderWithItems, now: Date = new Date()): OrderResponseDto["quote"] {
    const q = order.quote;
    if (!order.quoteId || !q) return null;
    const hidden =
      !!order.pickupDate &&
      now.getTime() >= order.pickupDate.getTime() + QUOTE_CONTENT_HOURS_AFTER_PICKUP * 3600 * 1000;
    return {
      quoteRequestId: q.quoteRequest.id,
      similarityLabel: QUOTE_SIMILARITY_LABELS[q.similarity].label,
      memo: q.memo,
      quotePhotoUrls: q.photoUrls,
      description: hidden ? null : q.quoteRequest.description,
      requestNote: hidden ? null : q.quoteRequest.requestNote,
      requestPhotoUrls: hidden ? [] : q.quoteRequest.photoUrls,
      contentHidden: hidden,
    };
  }

  static mapToOrderResponse(order: OrderWithItems): OrderResponseDto {
    return {
      id: order.id,
      userId: order.consumerId,
      productId: order.productId,
      quote: this.quoteInfo(order),
      productName: order.productName ?? "",
      productImages: order.productImages ?? [],
      storeId: order.storeId,
      storeName: order.storeName ?? "",
      storePhoneNumber: order.store.phoneNumber ?? null,
      storeKakaoChannelId: order.store.kakaoChannelId ?? null,
      storeInstagramId: order.store.instagramId ?? null,
      storeBankName: order.store.bankName ?? null,
      storeBankAccountNumber: order.store.bankAccountNumber ?? null,
      storeAccountHolderName: order.store.accountHolderName ?? null,
      storeRefundCancellationPolicy: refundCancellationPolicyFromDb(
        order.store.refundCancellationPolicy,
      ),
      orderNumber: order.orderNumber,
      totalQuantity: order.totalQuantity,
      totalPrice: order.totalPrice,
      // 픽업 정보
      pickupDate: order.pickupDate ?? new Date(),
      pickupAddress: order.pickupAddress ?? "",
      pickupRoadAddress: order.pickupRoadAddress ?? "",
      pickupDetailAddress: order.pickupDetailAddress ?? "",
      pickupZonecode: order.pickupZonecode ?? "",
      pickupLatitude: order.pickupLatitude ?? 0,
      pickupLongitude: order.pickupLongitude ?? 0,
      orderStatus: order.orderStatus as OrderStatus,
      paymentPendingAt: order.paymentPendingAt ?? null,
      paymentPendingDeadlineAt: order.paymentPendingDeadlineAt ?? null,
      depositorName: order.depositorName ?? null,
      paymentPendingExpiredAt: order.paymentPendingExpiredAt ?? null,
      reservationContactName: order.reservationContactName ?? null,
      reservationPhone: order.reservationPhone ?? null,
      userCancelReason: order.userCancelReason ?? null,
      sellerCancelReason: order.sellerCancelReason ?? null,
      sellerNoShowReason: order.sellerNoShowReason ?? null,
      refundRequestReason: order.refundRequestReason ?? null,
      refundBankName: order.refundBankName ?? null,
      refundBankAccountNumber: order.refundBankAccountNumber ?? null,
      refundAccountHolderName: order.refundAccountHolderName ?? null,
      sellerCancelRefundPendingReason: order.sellerCancelRefundPendingReason ?? null,
      adminRefundRevertReason: order.adminRefundRevertReason ?? null,
      adminRefundRevertedAt: order.adminRefundRevertedAt ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      orderItems: order.orderItems.map((item) => this.mapToOrderItemResponse(item)),
      ...this.reviewUiFromOrder(order),
    } satisfies OrderResponseDto;
  }
}
