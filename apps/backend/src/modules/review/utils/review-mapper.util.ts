import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import {
  ReviewResponseDto,
  MyReviewResponseDto,
} from "@apps/backend/modules/review/dto/review-detail.dto";
import {
  ORDER_RESPONSE_STORE_SELECT,
  OrderMapperUtil,
} from "@apps/backend/modules/order/utils/order-mapper.util";

/**
 * User · Product(Store) · Order(항목 포함) 정보가 포함된 ProductReview 타입
 */
type ProductReviewWithUserAndProductStore = Prisma.ProductReviewGetPayload<{
  include: {
    consumer: {
      select: {
        nickname: true;
        profileImageUrl: true;
      };
    };
    product: {
      include: { store: { select: { name: true } } };
    };
    order: {
      include: {
        orderItems: true;
        review: {
          select: {
            id: true;
            deletedAt: true;
          };
        };
        store: {
          select: typeof ORDER_RESPONSE_STORE_SELECT;
        };
      };
    };
  };
}>;

/** `mapToReviewResponse`에 필요한 최소 ProductReview 형태 */
type ProductReviewResponseSource = {
  id: string;
  productId: string;
  consumerId: string;
  orderId: string | null;
  rating: number;
  content: string;
  imageUrls: string[];
  createdAt: Date;
  updatedAt: Date;
  consumer: {
    nickname: string | null;
    profileImageUrl: string | null;
  };
  product: {
    storeId: string;
    store: { name: string };
  };
  /** 공개 후기 응답에는 쓰지 않는다(아래 mapToReviewResponse). 내 후기만 읽어 온다 */
  order?: ProductReviewWithUserAndProductStore["order"];
};

/** 마이페이지 내 후기 조회용 ProductReview 타입 (상품 요약 필드 포함) */
type ProductReviewForMyReview = ProductReviewResponseSource & {
  order: ProductReviewWithUserAndProductStore["order"];
  product: ProductReviewResponseSource["product"] & {
    name: string;
    salePrice: number;
    images: string[];
  };
};

/**
 * 후기 매핑 유틸리티
 * Prisma ProductReview 엔티티를 ReviewResponseDto로 변환하는 공통 로직을 제공합니다.
 */
export class ReviewMapperUtil {
  /**
   * User 정보 select 필드
   * 후기 조회 시 user의 nickname과 profileImageUrl을 가져오기 위한 공통 select 필드
   */
  static readonly USER_INFO_SELECT = {
    nickname: true,
    profileImageUrl: true,
  } as const satisfies Prisma.ConsumerSelect;

  /**
   * Product + Store 정보 include
   * 후기 조회 시 storeId, storeName을 응답에 포함하기 위한 공통 include
   */
  static readonly PRODUCT_STORE_INCLUDE = {
    product: {
      include: { store: { select: { name: true } } },
    },
  } as const;

  /**
   * 후기 응답에 주문 내역을 붙이기 위한 include (주문과 연결된 행만 order가 채워짐)
   */
  static readonly REVIEW_ORDER_INCLUDE = {
    order: {
      include: {
        orderItems: true,
        review: {
          select: { id: true, deletedAt: true },
        },
        store: {
          select: ORDER_RESPONSE_STORE_SELECT,
        },
      },
    },
  } as const;

  /**
   * 마이페이지 내 후기 목록·상세 조회용 include
   * 주문 연동(`order`)과 상품 요약 필드를 함께 로드합니다.
   */
  static readonly MY_REVIEW_INCLUDE = {
    consumer: {
      select: ReviewMapperUtil.USER_INFO_SELECT,
    },
    product: {
      select: {
        name: true,
        salePrice: true,
        images: true,
        storeId: true,
        store: { select: { name: true } },
      },
    },
    ...ReviewMapperUtil.REVIEW_ORDER_INCLUDE,
  } as const;

  /**
   * Prisma ProductReview 엔티티를 ReviewResponseDto로 변환 — 로그인 없이 누구나 보는 공개 후기용.
   * 주문(`order`)은 늘 null: 주문에는 예약자 이름·휴대폰·입금자명·환불 계좌가 들어 있어 공개 응답에 실으면 안 된다
   * (11-16 검토 — 그전에는 공개 후기 목록·상세가 주문 전체를 함께 돌려줬다). 주문은 내 후기(mapToMyReviewResponse)에만.
   * @param review - Prisma ProductReview 엔티티 (consumer, product.store 포함)
   * @returns ReviewResponseDto 객체
   */
  static mapToReviewResponse(review: ProductReviewResponseSource): ReviewResponseDto {
    return {
      id: review.id,
      productId: review.productId,
      storeId: review.product.storeId,
      storeName: review.product.store.name,
      userId: review.consumerId,
      orderId: review.orderId ?? null,
      order: null,
      rating: review.rating,
      content: review.content,
      imageUrls: review.imageUrls,
      userNickname: review.consumer.nickname,
      userProfileImageUrl: review.consumer.profileImageUrl,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  /**
   * 마이페이지 내 후기 응답 변환
   * 연결 주문이 있으면 주문 스냅샷을 우선하고, 없으면 현재 상품 정보로 UI 필드를 채웁니다.
   */
  static mapToMyReviewResponse(review: ProductReviewForMyReview): MyReviewResponseDto {
    const base = this.mapToReviewResponse(review);
    const order = review.order;

    return {
      ...base,
      // 내 후기에만 주문을 붙인다(본인 주문)
      order: order ? OrderMapperUtil.mapToOrderResponse(order) : null,
      productName: order?.productName ?? review.product.name,
      productPrice: order?.totalPrice ?? review.product.salePrice,
      productImageUrl: order?.productImages?.[0] ?? review.product.images[0] ?? null,
    };
  }
}
