import { BadRequestException } from "@nestjs/common";
import {
  EnableStatus,
  PRODUCT_ERROR_MESSAGES,
  ProductOrderMethod,
  ProductType,
} from "@apps/backend/modules/product/constants/product.constants";
import { parseCustomOptions } from "@apps/backend/modules/product/utils/product-custom-option.util";

/**
 * 저장할 주문 받는 방법(기획 I-01 2026-11-19).
 * - 기본 케이크는 정해진 디자인이라 늘 예약 받기. 견적 받기를 보내면 막는다(화면은 커스텀 케이크에서만 고르게 함)
 * - 커스텀 케이크는 보낸 값, 없으면 지금 값, 그것도 없으면(새 상품) 예약 받기
 * - 커스텀 → 기본으로 바꾸면서 방법을 보내지 않으면 예약 받기로 돌린다
 */
export function resolveProductOrderMethod(params: {
  productType: ProductType;
  requested?: ProductOrderMethod;
  current?: ProductOrderMethod;
}): ProductOrderMethod {
  const { productType, requested, current } = params;
  if (productType !== ProductType.CUSTOM_CAKE) {
    if (requested === ProductOrderMethod.QUOTE) {
      throw new BadRequestException(PRODUCT_ERROR_MESSAGES.QUOTE_NEEDS_CUSTOM_CAKE);
    }
    return ProductOrderMethod.RESERVATION;
  }
  return requested ?? current ?? ProductOrderMethod.RESERVATION;
}

function isPositivePrice(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 손님에게 보이는 사이즈·추가 옵션 선택지에 0원보다 큰 추가금이 하나라도 있는지.
 * 없으면 손님 화면 가격 뒤 물결(~)을 빼고 딱 그 값으로 보인다(운영자 2026-11-19).
 * 숨긴 사이즈·옵션·선택지는 손님이 고를 수 없어 세지 않는다.
 */
export function productHasExtraPrice(cakeSizeOptions: unknown, customOptions: unknown): boolean {
  const sizes = Array.isArray(cakeSizeOptions) ? cakeSizeOptions : [];
  const sizeExtra = sizes.some(
    (size) =>
      size !== null &&
      typeof size === "object" &&
      (size as { visible?: unknown }).visible === EnableStatus.ENABLE &&
      isPositivePrice((size as { price?: unknown }).price),
  );
  if (sizeExtra) return true;
  return parseCustomOptions(customOptions).some(
    (option) =>
      option.visible === EnableStatus.ENABLE &&
      (option.choices ?? []).some(
        (choice) => choice.visible === EnableStatus.ENABLE && isPositivePrice(choice.price),
      ),
  );
}
