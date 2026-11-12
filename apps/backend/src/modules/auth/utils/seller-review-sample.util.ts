import {
  EnableStatus,
  OrderStatus,
  Prisma,
  ProductType,
  StoreBankName,
} from "@apps/backend/infra/database/prisma/generated/client";
import { computePaymentPendingDeadline } from "@apps/backend/modules/order/utils/order-datetime.util";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";
import { koreaCalendarYmd } from "@apps/backend/modules/order/utils/order-list-query.util";

/**
 * 판매자 앱 심사용 가게의 예시 데이터 (I-48, SC-62).
 *
 * 심사관이 판매자 앱을 끝까지 눌러 볼 수 있게 가게 하나, 상품 둘, 상태별 주문 여덟 건을 둔다.
 * 가게·상품은 없을 때만 만들고(운영자가 심사 전에 사진을 올려 두면 그대로 남는다),
 * 주문은 심사용 로그인 때마다 지우고 다시 만든다(처리 버튼을 매번 처음부터 눌러 볼 수 있게).
 * 이름·주소·계좌는 모두 예시 값이다. 주소는 공공기관(서울시청) 주소를 쓴다.
 */
export const SELLER_REVIEW_SAMPLE = {
  SELLER_NAME: "심사용 사장님",
  CONSUMER_NAME: "예시 손님",
  STORE_NAME: "픽케이크 심사용 가게",
} as const;

/**
 * 심사용 예시 대화(기획 I-11, 애플 심사 1.2: 심사관이 채팅·신고·차단을 눌러 볼 수 있게).
 * 마지막 글이 손님 것이라 "답할 채팅 1"로 보이고, 사장님 이용 규칙 동의는 남기지 않아 처음 보낼 때 규칙 창이 뜬다.
 * 분 단위 숫자는 로그인 시각보다 그만큼 앞선 시각이다.
 */
export const SELLER_REVIEW_SAMPLE_CHAT: {
  sender: "CONSUMER" | "SHOP";
  text: string;
  minutesAgo: number;
}[] = [
  {
    sender: "CONSUMER",
    text: "안녕하세요! 이번 주 토요일 픽업으로 레터링 케이크 문의드려요.",
    minutesAgo: 30,
  },
  { sender: "SHOP", text: "네, 안녕하세요. 어떤 문구로 넣어 드릴까요?", minutesAgo: 25 },
  {
    sender: "CONSUMER",
    text: '"생일 축하해"로 부탁드려요. 초도 같이 받을 수 있을까요?',
    minutesAgo: 5,
  },
];

const STORE_ADDRESS = {
  address: "서울특별시 중구 태평로1가 31",
  roadAddress: "서울특별시 중구 세종대로 110",
  detailAddress: "1층",
  zonecode: "04524",
  latitude: 37.5662952,
  longitude: 126.9779451,
} as const;

/** 심사용 가게 만들기 값 */
export function buildReviewStoreCreateData(sellerId: string): Prisma.StoreUncheckedCreateInput {
  return {
    sellerId,
    name: SELLER_REVIEW_SAMPLE.STORE_NAME,
    description:
      "앱 심사를 위한 예시 가게예요. 손님 화면(목록·검색·지도)에는 보이지 않고, 주문도 예시예요.",
    phoneNumber: "010-0000-0000",
    ...STORE_ADDRESS,
    businessNo: REVIEW_STORE_BUSINESS_NO,
    representativeName: "픽케이크",
    openingDate: "20260101",
    businessName: SELLER_REVIEW_SAMPLE.STORE_NAME,
    businessSector: "제과점업",
    businessType: "제조업",
    bankName: StoreBankName.KAKAO_BANK,
    bankAccountNumber: "0000-00-0000000",
    accountHolderName: "픽케이크",
    standardOpenTime: "10:00",
    standardCloseTime: "20:00",
    refundCancellationPolicy: {
      rules: [
        { daysBeforePickup: 3, refundDescription: "결제 금액 전액 환불" },
        { daysBeforePickup: 1, refundDescription: "결제 금액의 50% 환불" },
        { daysBeforePickup: 0, refundDescription: "환불 불가" },
      ],
    },
  };
}

type SampleSize = {
  id: string;
  visible: EnableStatus;
  displayName: string;
  lengthCm: number;
  price: number;
  description: string;
};

type SampleChoice = { id: string; label: string; price: number; visible: EnableStatus };

type SampleOption =
  | {
      id: string;
      type: "SINGLE_SELECT";
      name: string;
      required: boolean;
      visible: EnableStatus;
      choices: SampleChoice[];
    }
  | {
      id: string;
      type: "TEXT";
      name: string;
      required: boolean;
      visible: EnableStatus;
      maxLength: number;
      placeholder: string;
    };

type SampleProduct = {
  /** 상품을 다시 찾을 때 쓰는 값. 심사관이 이름을 바꿔도 같은 상품으로 본다 */
  productNumber: string;
  name: string;
  productType: ProductType;
  salePrice: number;
  sizes: SampleSize[];
  options: SampleOption[];
  detailDescription: string;
};

const ON = EnableStatus.ENABLE;

export const REVIEW_SAMPLE_PRODUCTS: readonly SampleProduct[] = [
  {
    productNumber: "REVIEW-SAMPLE-1",
    name: "딸기 생크림 케이크",
    productType: ProductType.BASIC_CAKE,
    salePrice: 32000,
    sizes: [
      {
        id: "review-size-mini",
        visible: ON,
        displayName: "미니",
        lengthCm: 12,
        price: 0,
        description: "1~2인",
      },
      {
        id: "review-size-1",
        visible: ON,
        displayName: "1호",
        lengthCm: 15,
        price: 8000,
        description: "2~3인",
      },
    ],
    options: [
      {
        id: "review-opt-lettering",
        type: "TEXT",
        name: "레터링 문구",
        required: false,
        visible: ON,
        maxLength: 20,
        placeholder: "케이크 위에 쓸 문구를 적어 주세요",
      },
      {
        id: "review-opt-candle",
        type: "SINGLE_SELECT",
        name: "초",
        required: false,
        visible: ON,
        choices: [
          { id: "review-choice-candle-long", label: "긴 초", price: 0, visible: ON },
          { id: "review-choice-candle-number", label: "숫자 초", price: 1000, visible: ON },
        ],
      },
    ],
    detailDescription:
      "<p>심사용 예시 상품이에요. 생크림과 딸기를 올린 기본 케이크예요.</p><p>실제로 판매하지 않아요.</p>",
  },
  {
    productNumber: "REVIEW-SAMPLE-2",
    name: "레터링 주문 케이크",
    productType: ProductType.CUSTOM_CAKE,
    salePrice: 45000,
    sizes: [
      {
        id: "review-size-1-custom",
        visible: ON,
        displayName: "1호",
        lengthCm: 15,
        price: 0,
        description: "2~3인",
      },
      {
        id: "review-size-2-custom",
        visible: ON,
        displayName: "2호",
        lengthCm: 18,
        price: 10000,
        description: "4~6인",
      },
    ],
    options: [
      {
        id: "review-opt-flavor",
        type: "SINGLE_SELECT",
        name: "맛",
        required: true,
        visible: ON,
        choices: [
          { id: "review-choice-choco", label: "초콜릿", price: 0, visible: ON },
          { id: "review-choice-vanilla", label: "바닐라", price: 0, visible: ON },
          { id: "review-choice-earlgrey", label: "얼그레이", price: 2000, visible: ON },
        ],
      },
      {
        id: "review-opt-lettering-custom",
        type: "TEXT",
        name: "레터링 문구",
        required: true,
        visible: ON,
        maxLength: 30,
        placeholder: "케이크 위에 쓸 문구를 적어 주세요",
      },
    ],
    detailDescription:
      "<p>심사용 예시 상품이에요. 손님이 고른 맛과 문구로 만드는 주문 케이크예요.</p><p>실제로 판매하지 않아요.</p>",
  },
];

/** 예시 상품 만들기 값 */
export function buildReviewProductCreateData(
  storeId: string,
  product: SampleProduct,
): Prisma.ProductUncheckedCreateInput {
  return {
    storeId,
    name: product.name,
    originalPrice: product.salePrice,
    salePrice: product.salePrice,
    salesStatus: ON,
    visibilityStatus: ON,
    productType: product.productType,
    detailDescription: product.detailDescription,
    cakeSizeOptions: product.sizes as unknown as Prisma.InputJsonValue,
    customOptions: product.options as unknown as Prisma.InputJsonValue,
    letteringVisible: ON,
    letteringMaxLength: 20,
    imageUploadEnabled: EnableStatus.DISABLE,
    productNumber: product.productNumber,
    productNoticeFoodType: "빵류",
    productNoticeProducer: SELLER_REVIEW_SAMPLE.STORE_NAME,
    productNoticeOrigin: "국내산",
    productNoticeAddress: "서울특별시 중구",
    productNoticeManufactureDate: "주문 후 제작(픽업일 제조)",
    productNoticeExpirationDate: "제조일로부터 2일",
    productNoticePackageCapacity: "1개",
    productNoticePackageQuantity: "1개",
    productNoticeIngredients: "밀가루, 우유, 생크림, 계란, 설탕",
    productNoticeCalories: "상세 설명 참고",
    productNoticeSafetyNotice: "알레르기 유발 성분: 밀, 우유, 계란",
    productNoticeGmoNotice: "해당 없음",
    productNoticeImportNotice: "해당 없음",
    productNoticeCustomerService: "가게 전화로 문의",
  };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 한국 시각 기준 `dayOffset`일 뒤 `hour`:`minute` (오늘 = 0) */
export function kstAt(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + dayOffset, hour, minute) -
      KST_OFFSET_MS,
  );
}

type SampleOrderProduct = {
  id: string;
  name: string;
  salePrice: number;
  images: string[];
  productNumber: string;
};

type SampleOrderSpec = {
  status: OrderStatus;
  productNumber: string;
  sizeId: string;
  /** 고른 선택형 옵션값 [옵션 id, 옵션값 id] */
  choices?: [string, string][];
  /** 적은 문구 [옵션 id, 문구] */
  texts?: [string, string][];
  requestMessage?: string;
  pickupAt: (now: Date) => Date;
  createdAgoHours: number;
};

/** 오후 5시가 지나면 오늘 픽업 대신 내일 오전 픽업으로(심사 시각과 상관없이 "곧 픽업"으로 보이게) */
function soonPickup(now: Date): Date {
  const kstHour = new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
  return kstHour < 17 ? kstAt(now, 0, 18) : kstAt(now, 1, 11);
}

const SAMPLE_ORDERS: readonly SampleOrderSpec[] = [
  {
    status: OrderStatus.RESERVATION_REQUESTED,
    productNumber: "REVIEW-SAMPLE-1",
    sizeId: "review-size-1",
    choices: [["review-opt-candle", "review-choice-candle-long"]],
    texts: [["review-opt-lettering", "생일 축하해"]],
    requestMessage: "보냉백에 담아 주세요",
    pickupAt: (now) => kstAt(now, 1, 14),
    createdAgoHours: 0.5,
  },
  {
    status: OrderStatus.PAYMENT_PENDING,
    productNumber: "REVIEW-SAMPLE-2",
    sizeId: "review-size-1-custom",
    choices: [["review-opt-flavor", "review-choice-choco"]],
    texts: [["review-opt-lettering-custom", "결혼 1주년 축하해"]],
    pickupAt: (now) => kstAt(now, 2, 15),
    createdAgoHours: 3,
  },
  {
    status: OrderStatus.PAYMENT_COMPLETED,
    productNumber: "REVIEW-SAMPLE-1",
    sizeId: "review-size-mini",
    choices: [["review-opt-candle", "review-choice-candle-number"]],
    pickupAt: (now) => kstAt(now, 2, 11),
    createdAgoHours: 5,
  },
  {
    status: OrderStatus.CONFIRMED,
    productNumber: "REVIEW-SAMPLE-2",
    sizeId: "review-size-2-custom",
    choices: [["review-opt-flavor", "review-choice-earlgrey"]],
    texts: [["review-opt-lettering-custom", "합격 축하해"]],
    pickupAt: (now) => kstAt(now, 3, 16),
    createdAgoHours: 26,
  },
  {
    status: OrderStatus.PICKUP_PENDING,
    productNumber: "REVIEW-SAMPLE-1",
    sizeId: "review-size-1",
    texts: [["review-opt-lettering", "고마워요"]],
    pickupAt: soonPickup,
    createdAgoHours: 50,
  },
  {
    status: OrderStatus.CANCEL_REFUND_PENDING,
    productNumber: "REVIEW-SAMPLE-1",
    sizeId: "review-size-mini",
    pickupAt: (now) => kstAt(now, 4, 13),
    createdAgoHours: 30,
  },
  {
    status: OrderStatus.PICKUP_COMPLETED,
    productNumber: "REVIEW-SAMPLE-2",
    sizeId: "review-size-1-custom",
    choices: [["review-opt-flavor", "review-choice-vanilla"]],
    texts: [["review-opt-lettering-custom", "졸업 축하해"]],
    pickupAt: (now) => kstAt(now, -2, 15),
    createdAgoHours: 120,
  },
  {
    status: OrderStatus.CANCEL_COMPLETED,
    productNumber: "REVIEW-SAMPLE-1",
    sizeId: "review-size-1",
    pickupAt: (now) => kstAt(now, -1, 12),
    createdAgoHours: 72,
  },
];

/** 입금 단계를 지난 주문 상태 (입금대기로 바꾼 시각·입금자명이 있어야 자연스럽다) */
const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.PAYMENT_COMPLETED,
  OrderStatus.CONFIRMED,
  OrderStatus.PICKUP_PENDING,
  OrderStatus.CANCEL_REFUND_PENDING,
  OrderStatus.PICKUP_COMPLETED,
];

/**
 * 상태별 예시 주문 만들기 값. 주문 번호는 실제 형식(ORD-날짜-번호)을 따르되 `R`로 시작하는 번호와 임의 글자를 붙여
 * 실제 주문 번호와 겹치지 않게 한다. 예약 연락처는 비워 두어 손님 알림톡이 나가지 않는다(휴대폰 번호가 아닌 계정 표시만 있음).
 */
export function buildReviewSampleOrders(params: {
  now: Date;
  storeId: string;
  storeName: string;
  consumerId: string;
  products: SampleOrderProduct[];
  randomSuffix: () => string;
}): Prisma.OrderUncheckedCreateInput[] {
  const { now, storeId, storeName, consumerId, products, randomSuffix } = params;
  const dateStr = koreaCalendarYmd(now).replace(/-/g, ""); // 실제 주문번호와 같은 한국 날짜
  const byNumber = new Map(products.map((product) => [product.productNumber, product]));

  return SAMPLE_ORDERS.flatMap((spec, index) => {
    const product = byNumber.get(spec.productNumber);
    const sample = REVIEW_SAMPLE_PRODUCTS.find((p) => p.productNumber === spec.productNumber);
    if (!product || !sample) return [];

    const size = sample.sizes.find((s) => s.id === spec.sizeId) ?? null;
    const selectedOptions = buildSelectedOptions(sample, spec);
    const optionsPrice = selectedOptions.reduce((sum, option) => sum + option.price, 0);
    // 상품 값은 심사관이 바꿀 수 있으니 지금 상품 가격을 기준으로 한다(주문 시점 값 보존과 같은 방식)
    const itemPrice = product.salePrice + (size?.price ?? 0) + optionsPrice;
    const pickupDate = spec.pickupAt(now);
    const createdAt = new Date(now.getTime() - spec.createdAgoHours * HOUR_MS);
    const isPaid = PAID_STATUSES.includes(spec.status);
    const paymentPendingAt =
      spec.status === OrderStatus.PAYMENT_PENDING
        ? new Date(now.getTime() - HOUR_MS)
        : isPaid
          ? new Date(createdAt.getTime() + 0.25 * HOUR_MS)
          : null;
    const firstText = selectedOptions.find((option) => option.type === "TEXT");

    const order: Prisma.OrderUncheckedCreateInput = {
      consumerId,
      productId: product.id,
      productName: product.name,
      productImages: product.images,
      storeId,
      storeName,
      orderNumber: `ORD-${dateStr}-R${String(index + 1).padStart(2, "0")}${randomSuffix()}`,
      totalQuantity: 1,
      totalPrice: itemPrice,
      pickupDate,
      pickupAddress: STORE_ADDRESS.address,
      pickupRoadAddress: STORE_ADDRESS.roadAddress,
      pickupDetailAddress: STORE_ADDRESS.detailAddress,
      pickupZonecode: STORE_ADDRESS.zonecode,
      pickupLatitude: STORE_ADDRESS.latitude,
      pickupLongitude: STORE_ADDRESS.longitude,
      reservationContactName: SELLER_REVIEW_SAMPLE.CONSUMER_NAME,
      reservationPhone: null,
      orderStatus: spec.status,
      paymentPendingAt,
      paymentPendingDeadlineAt: paymentPendingAt
        ? computePaymentPendingDeadline(paymentPendingAt, pickupDate)
        : null,
      depositorName: isPaid ? "예시손님" : null,
      createdAt,
      orderItems: {
        create: [
          {
            sizeId: size?.id ?? null,
            sizeDisplayName: size?.displayName ?? null,
            sizeLengthCm: size?.lengthCm ?? null,
            sizeDescription: size?.description ?? null,
            sizePrice: size?.price ?? null,
            selectedOptions: selectedOptions as unknown as Prisma.InputJsonValue,
            optionsPrice,
            letteringMessage: firstText?.text ?? null,
            requestMessage: spec.requestMessage ?? null,
            quantity: 1,
            itemPrice,
          },
        ],
      },
    };

    if (spec.status === OrderStatus.CANCEL_REFUND_PENDING) {
      order.refundRequestReason = "픽업 날짜에 일정이 생겼어요";
      order.refundBankName = StoreBankName.KAKAO_BANK;
      order.refundBankAccountNumber = "0000-00-0000000";
      order.refundAccountHolderName = "예시손님";
    }
    if (spec.status === OrderStatus.CANCEL_COMPLETED) {
      order.userCancelReason = "다른 날로 다시 주문할게요";
    }
    return [order];
  });
}

type SampleSelectedOption = {
  optionId: string;
  type: "SINGLE_SELECT" | "TEXT";
  name: string;
  choices?: { id: string; label: string; price: number }[];
  text?: string;
  price: number;
};

/** 주문 항목에 저장하는 옵션 스냅샷(order_items.selected_options)과 같은 모양 */
function buildSelectedOptions(
  sample: SampleProduct,
  spec: SampleOrderSpec,
): SampleSelectedOption[] {
  const picked: SampleSelectedOption[] = [];
  for (const option of sample.options) {
    if (option.type === "SINGLE_SELECT") {
      const choiceId = spec.choices?.find(([optionId]) => optionId === option.id)?.[1];
      const choice = option.choices.find((c) => c.id === choiceId);
      if (!choice) continue;
      picked.push({
        optionId: option.id,
        type: option.type,
        name: option.name,
        choices: [{ id: choice.id, label: choice.label, price: choice.price }],
        price: choice.price,
      });
    } else {
      const text = spec.texts?.find(([optionId]) => optionId === option.id)?.[1];
      if (!text) continue;
      picked.push({ optionId: option.id, type: option.type, name: option.name, text, price: 0 });
    }
  }
  return picked;
}
