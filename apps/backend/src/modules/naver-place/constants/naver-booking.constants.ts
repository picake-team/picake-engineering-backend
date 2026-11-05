/**
 * 네이버 예약(상품·옵션) 조회 상수
 *
 * 네이버 예약 모바일 화면이 쓰는 GraphQL 요청과 같은 형태로 읽는다.
 * - 상품 목록: m.booking.naver.com `bizItems`
 * - 예약 가능 시간: porta.place.naver.com `hourlySchedule`
 * - 옵션: porta.place.naver.com `option` (예약 시간 하나를 정해야 조회된다)
 */

/** 상품 목록 GraphQL 주소 (고정) */
export const NAVER_BOOKING_ITEMS_ENDPOINT = "https://m.booking.naver.com/graphql?opName=bizItems";

/** 예약 시간·옵션 GraphQL 주소 (고정) */
export const NAVER_BOOKING_PORTA_ENDPOINT = "https://porta.place.naver.com/graphql";

/** 네이버 예약 업체 ID·상품 ID 형식 (숫자만) */
export const NAVER_BOOKING_ID_REGEX = /^\d{1,15}$/;

/** 상품에 저장하는 네이버 연결 키: 예약 상품 ID, 또는 상품 안 옵션 하나는 "상품ID-o옵션ID" */
export const NAVER_PRODUCT_LINK_KEY_REGEX = /^\d{1,15}(-o\d{1,15})?$/;

/** 옵션을 읽을 예약 시간을 찾는 기간 (오늘부터 며칠) */
export const NAVER_BOOKING_SCHEDULE_LOOKAHEAD_DAYS = 30;

/** 네이버 예약 업종 기본값 (식당·픽업) */
export const NAVER_BOOKING_DEFAULT_BUSINESS_TYPE_ID = 6;

/** 상품 사진으로 받는 최대 수 */
export const NAVER_BOOKING_MAX_IMAGES = 10;

/** 한 번에 Picake로 옮기는 최대 사진 수 */
export const NAVER_IMAGE_IMPORT_MAX = 5;

/** 사진 1장 최대 크기 (업로드 제한과 같음) */
export const NAVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** 네이버 사진을 받을 수 있는 호스트 (네이버 이미지 서버만) */
export const NAVER_IMAGE_HOST_SUFFIX = ".pstatic.net";

/** 상품 목록 쿼리 (화면에 쓰는 필드만) */
export const NAVER_BOOKING_ITEMS_QUERY = `query bizItems($input: BizItemsParams) {
  bizItems(input: $input) {
    bizItemId
    name
    desc
    price
    bizItemType
    bizItemSubType
    isRequiringBookingOption
    isClosedBooking
    isImp
    bookingPrecautionJson { title desc }
    bizItemResources { resourceUrl order }
  }
}`;

/** 예약 가능 시간 쿼리 */
export const NAVER_BOOKING_SCHEDULE_QUERY = `query HourlySchedule($input: HourlyScheduleParams!) {
  hourlySchedule(input: $input) {
    scheduleId
    slotId
    unitStartDateTime
    isBusinessDay
    isSaleDay
    isUnitBusinessDay
    isUnitSaleDay
  }
}`;

/** 예약 가능 날짜 쿼리 (날짜 단위 예약 방식) */
export const NAVER_BOOKING_DAILY_SCHEDULE_QUERY = `query TimeSlotAvailabilityDailySummaries($input: TimeSlotAvailabilityDailySummariesParams!) {
  timeSlotAvailabilityDailySummaries(input: $input) {
    date
    isHoliday
    hasSlots
  }
}`;

/** 옵션 쿼리 */
export const NAVER_BOOKING_OPTION_QUERY = `query Option($input: OptionParams!) {
  option(input: $input) {
    categoryId
    name
    selectionTypeCode
    children {
      categoryId
      name
      options { optionId name price normalPrice remainStock isSoldOut }
    }
    options {
      optionId
      name
      desc
      priceDesc
      price
      normalPrice
      stock
      remainStock
      isSoldOut
      isTodaySoldOut
      titleImageUrl
    }
  }
}`;

/** 네이버 예약 에러 메시지 */
export const NAVER_BOOKING_ERROR_MESSAGES = {
  NOT_CONNECTED: "스토어에 네이버 매장을 먼저 연결해 주세요. (스토어 수정 → 네이버 플레이스)",
  ITEM_NOT_FOUND: "네이버에서 이 상품을 찾지 못했어요. 네이버에서 지웠거나 숨긴 상품일 수 있어요.",
  FETCH_FAILED:
    "네이버 예약에서 상품을 가져오지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.",
  INVALID_ITEM: "네이버 상품 번호를 확인해 주세요.",
  IMAGE_NOT_FOUND: "고른 네이버 사진을 찾지 못했어요. 상품을 다시 불러와 주세요.",
  IMAGE_FAILED: "네이버 사진을 가져오지 못했어요. 사진을 직접 올려 주세요.",
};

/** 상품 가져오기 경고 메시지 */
export const NAVER_PRODUCT_WARNINGS = {
  NO_BOOKING:
    "이 네이버 매장은 네이버 예약을 쓰지 않아서 메뉴(이름·가격·설명)만 가져올 수 있어요. 옵션은 직접 입력해 주세요.",
  OPTIONS_UNAVAILABLE:
    "예약 가능한 날이 없어 옵션을 읽지 못했어요. 네이버에서 예약을 열어 둔 뒤 다시 불러오거나 옵션을 직접 입력해 주세요.",
  OPTIONS_FAILED:
    "이 네이버 상품은 옵션을 읽을 수 없는 방식이에요(프랜차이즈 주문 등). 이름·설명·사진만 가져오고 옵션은 직접 입력해 주세요.",
  NO_OPTIONS: "네이버 상품에 옵션이 없어요. 사이즈와 가격을 직접 입력해 주세요.",
  NO_SIZE_OPTION:
    "사이즈로 볼 수 있는 옵션이 없어요. 사이즈(도시락·미니·1~3호)와 가격을 직접 정해 주세요.",
  FLAVOR_REQUIRED: "네이버에는 맛 정보가 따로 없어요. 맛을 1개 이상 직접 입력해 주세요.",
  MENU_LIKE:
    "이 네이버 상품은 여러 상품을 옵션으로 묶어 둔 것 같아요(예: 포장주문). 옵션마다 '이 옵션만 상품으로 가져오기'로 하나씩 가져오면 더 잘 맞아요.",
  VISIT_ITEM:
    "네이버에서 매장 방문(테이블) 예약으로 만든 상품이에요. 픽업 상품과 맞지 않을 수 있으니 내용을 꼭 확인해 주세요.",
  OPTION_AS_PRODUCT: (itemName: string) =>
    `'${itemName}' 안의 옵션 하나를 상품으로 가져왔어요. 사이즈와 맛은 직접 정해 주세요.`,
  PRICE_AMBIGUOUS:
    "네이버 상품 가격과 옵션 가격이 둘 다 있어 옵션 가격이 최종가인지 추가금인지 알 수 없어요. 가격을 확인해 주세요.",
  LENGTH_UNKNOWN: (name: string) =>
    `'${name}'의 지름(cm)을 네이버에서 찾지 못했어요. 직접 입력해 주세요.`,
  SOLD_OUT: (names: string) => `네이버에서 품절인 옵션이 있어요: ${names}`,
  ITEM_CLOSED: "네이버에서 예약을 받지 않는 상품이에요. 판매 상태를 확인해 주세요.",
  OPTION_NO_PRICE: "가격이 없는 안내 항목이라 넣지 않았어요.",
  TOO_MANY_EXTRAS: (max: number) =>
    `추가 옵션 선택지는 ${max}개까지예요. 넣을 선택지를 골라 주세요.`,
};
