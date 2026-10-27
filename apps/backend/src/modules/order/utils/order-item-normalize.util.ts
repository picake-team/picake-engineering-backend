import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  CreateOrderItemDto,
  OrderItemOptionInputDto,
} from "@apps/backend/modules/order/dto/order-create.dto";
import { ORDER_ERROR_MESSAGES } from "@apps/backend/modules/order/constants/order.constants";
import {
  CustomOptionType,
  EnableStatus,
} from "@apps/backend/modules/product/constants/product.constants";
import {
  CustomOption,
  isSelectOptionType,
  parseCustomOptions,
} from "@apps/backend/modules/product/utils/product-custom-option.util";
import { isAllowedUploadUrl } from "@apps/backend/modules/upload/utils/upload-url.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";

export type ParsedSizeOption = {
  id: string;
  visible: EnableStatus;
  displayName: string;
  lengthCm?: number;
  description?: string;
  price: number;
};

export type ParsedFlavorOption = {
  id: string;
  visible: EnableStatus;
  displayName: string;
  price: number;
};

/** 주문 항목에 저장하는 추가 옵션 스냅샷 (order_items.selected_options) */
export type SelectedOptionSnapshot = {
  optionId: string;
  type: CustomOptionType;
  name: string;
  choices?: { id: string; label: string; price: number }[];
  text?: string;
  imageUrls?: string[];
  price: number;
};

export type NormalizedOrderItemForCreate = {
  sizeId: string | null;
  sizeDisplayName: string | null;
  sizeLengthCm: number | null;
  sizeDescription: string | null;
  sizePrice: number | null;
  flavorId: string | null;
  flavorDisplayName: string | null;
  flavorPrice: number | null;
  selectedOptions: Prisma.InputJsonValue;
  optionsPrice: number;
  letteringMessage: string | null;
  requestMessage: string | null;
  quantity: number;
  itemPrice: number;
  imageUrls: string[];
};

/** 주문 항목 검증에 필요한 상품 정보 (DB 기준) */
export type OrderItemNormalizeContext = {
  sizeOptionMap: Map<string, ParsedSizeOption>;
  flavorOptionMap: Map<string, ParsedFlavorOption>;
  customOptions: CustomOption[];
  baseSalePrice: number;
};

/** 레거시 요청(letteringMessage·imageUrls)에 맞는 옵션이 상품에 없을 때 쓰는 스냅샷 ID */
const LEGACY_LETTERING_OPTION = { optionId: "legacy_lettering", name: "레터링 문구" } as const;
const LEGACY_IMAGE_OPTION = { optionId: "legacy_image", name: "참고사진" } as const;

export function parseSizeOptions(options: unknown): ParsedSizeOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }

      const candidate = option as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.visible !== "string" ||
        typeof candidate.displayName !== "string" ||
        typeof candidate.price !== "number"
      ) {
        return null;
      }

      const parsed: ParsedSizeOption = {
        id: candidate.id,
        visible: candidate.visible as EnableStatus,
        displayName: candidate.displayName,
        price: candidate.price,
      };
      if (typeof candidate.lengthCm === "number") {
        parsed.lengthCm = candidate.lengthCm;
      }
      if (typeof candidate.description === "string") {
        parsed.description = candidate.description;
      }
      return parsed;
    })
    .filter((option): option is ParsedSizeOption => option !== null);
}

export function parseFlavorOptions(options: unknown): ParsedFlavorOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }

      const candidate = option as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.visible !== "string" ||
        typeof candidate.displayName !== "string" ||
        typeof candidate.price !== "number"
      ) {
        return null;
      }

      return {
        id: candidate.id,
        visible: candidate.visible as EnableStatus,
        displayName: candidate.displayName,
        price: candidate.price,
      };
    })
    .filter((option): option is ParsedFlavorOption => option !== null);
}

/**
 * 상품 엔티티에서 주문 항목 검증 컨텍스트를 만듭니다.
 */
export function buildOrderItemNormalizeContext(product: {
  cakeSizeOptions: unknown;
  cakeFlavorOptions: unknown;
  customOptions?: unknown;
  salePrice: number;
}): OrderItemNormalizeContext {
  return {
    sizeOptionMap: new Map(
      parseSizeOptions(product.cakeSizeOptions).map((option) => [option.id, option]),
    ),
    flavorOptionMap: new Map(
      parseFlavorOptions(product.cakeFlavorOptions).map((option) => [option.id, option]),
    ),
    customOptions: parseCustomOptions(product.customOptions),
    baseSalePrice: product.salePrice,
  };
}

/**
 * 클라이언트가 본 옵션 버전이 현재와 다르면 409.
 * 버전을 보내지 않은 구버전 클라이언트는 확인하지 않습니다(ID·가격 검증은 그대로 적용).
 */
export function assertProductOptionsVersion(
  clientVersion: number | undefined,
  currentVersion: number,
): void {
  if (clientVersion !== undefined && clientVersion !== currentVersion) {
    LoggerUtil.log(
      `주문 항목 검증 실패: 옵션 버전 불일치 - client: ${clientVersion}, current: ${currentVersion}`,
    );
    throw new ConflictException(ORDER_ERROR_MESSAGES.PRODUCT_OPTIONS_CHANGED);
  }
}

function reject(message: string, logDetail: string): never {
  LoggerUtil.log(`주문 항목 검증 실패: ${logDetail}`);
  throw new BadRequestException(message);
}

function hasVisible(options: Iterable<{ visible: EnableStatus }>): boolean {
  for (const option of options) {
    if (option.visible === EnableStatus.ENABLE) return true;
  }
  return false;
}

function validateImageUrls(urls: string[], maxCount: number, logLabel: string): string[] {
  if (urls.length > maxCount || new Set(urls).size !== urls.length) {
    reject(ORDER_ERROR_MESSAGES.INVALID_OPTION_IMAGE, `${logLabel} 사진 개수·중복 오류`);
  }
  for (const url of urls) {
    if (!isAllowedUploadUrl(url)) {
      reject(ORDER_ERROR_MESSAGES.INVALID_OPTION_IMAGE, `${logLabel} 허용되지 않은 URL - ${url}`);
    }
  }
  return urls;
}

/**
 * 새 형식(options) 선택값 1개를 상품 옵션 기준으로 검증해 스냅샷을 만듭니다.
 * 선택값이 비어 있으면(빈 배열·공백 문구) 선택하지 않은 것으로 보고 null을 반환합니다.
 */
function normalizeOptionInput(
  option: CustomOption,
  input: OrderItemOptionInputDto,
): SelectedOptionSnapshot | null {
  const base = { optionId: option.id, type: option.type, name: option.name };

  if (isSelectOptionType(option.type)) {
    if (input.text !== undefined || input.imageUrls !== undefined) {
      reject(ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION, `선택형에 다른 값 전달 - ${option.id}`);
    }
    const choiceIds = input.choiceIds ?? [];
    if (choiceIds.length === 0) return null;

    const maxSelect =
      option.type === CustomOptionType.SINGLE_SELECT
        ? 1
        : (option.maxSelect ?? option.choices?.length ?? 0);
    if (choiceIds.length > maxSelect || new Set(choiceIds).size !== choiceIds.length) {
      reject(ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION, `선택 개수 오류 - ${option.id}`);
    }

    const choicesById = new Map((option.choices ?? []).map((choice) => [choice.id, choice]));
    const selectedChoices = choiceIds.map((choiceId) => {
      const choice = choicesById.get(choiceId);
      if (!choice || choice.visible !== EnableStatus.ENABLE) {
        reject(
          ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION,
          `없거나 숨김인 옵션값 - ${option.id}/${choiceId}`,
        );
      }
      return { id: choice.id, label: choice.label, price: choice.price };
    });
    // 판매자가 정한 옵션값 순서로 저장
    const order = new Map((option.choices ?? []).map((choice, index) => [choice.id, index]));
    selectedChoices.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return {
      ...base,
      choices: selectedChoices,
      price: selectedChoices.reduce((sum, choice) => sum + choice.price, 0),
    };
  }

  if (option.type === CustomOptionType.TEXT) {
    if (input.choiceIds !== undefined || input.imageUrls !== undefined) {
      reject(
        ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION,
        `직접입력형에 다른 값 전달 - ${option.id}`,
      );
    }
    const text = input.text?.trim() ?? "";
    if (!text) return null;
    if (text.length > (option.maxLength ?? 0)) {
      reject(ORDER_ERROR_MESSAGES.INVALID_OPTION_TEXT, `글자 수 초과 - ${option.id}`);
    }
    return { ...base, text, price: 0 };
  }

  // IMAGE
  if (input.choiceIds !== undefined || input.text !== undefined) {
    reject(
      ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION,
      `사진첨부형에 다른 값 전달 - ${option.id}`,
    );
  }
  const imageUrls = input.imageUrls ?? [];
  if (imageUrls.length === 0) return null;
  return {
    ...base,
    imageUrls: validateImageUrls(imageUrls, option.maxCount ?? 0, option.id),
    price: 0,
  };
}

/**
 * 구버전 요청(letteringMessage·imageUrls)을 추가 옵션 입력으로 바꿉니다.
 * 상품에 맞는 직접입력형·사진첨부형 옵션이 있으면 그 옵션으로, 없으면 레거시 스냅샷으로 저장합니다.
 */
function convertLegacyInput(
  item: CreateOrderItemDto,
  visibleOptions: CustomOption[],
): { inputs: OrderItemOptionInputDto[]; orphanSnapshots: SelectedOptionSnapshot[] } {
  const inputs: OrderItemOptionInputDto[] = [];
  const orphanSnapshots: SelectedOptionSnapshot[] = [];

  const lettering = item.letteringMessage?.trim();
  if (lettering) {
    const textOption = visibleOptions.find((option) => option.type === CustomOptionType.TEXT);
    if (textOption) {
      inputs.push({ optionId: textOption.id, text: lettering });
    } else {
      orphanSnapshots.push({
        ...LEGACY_LETTERING_OPTION,
        type: CustomOptionType.TEXT,
        text: lettering,
        price: 0,
      });
    }
  }

  const imageUrls = item.imageUrls ?? [];
  if (imageUrls.length > 0) {
    const imageOption = visibleOptions.find((option) => option.type === CustomOptionType.IMAGE);
    if (imageOption) {
      inputs.push({ optionId: imageOption.id, imageUrls });
    } else {
      orphanSnapshots.push({
        ...LEGACY_IMAGE_OPTION,
        type: CustomOptionType.IMAGE,
        imageUrls: validateImageUrls(imageUrls, imageUrls.length, "레거시"),
        price: 0,
      });
    }
  }

  return { inputs, orphanSnapshots };
}

/**
 * 추가 옵션 선택값을 검증하고 스냅샷·금액을 계산합니다.
 * - 노출 중인 옵션만 선택 가능, 같은 옵션 중복 불가
 * - 노출 중인 필수 옵션은 모두 선택해야 함
 * - 스냅샷은 판매자가 정한 옵션 순서로 저장
 */
export function normalizeSelectedOptions(
  item: CreateOrderItemDto,
  customOptions: CustomOption[],
): { selectedOptions: SelectedOptionSnapshot[]; optionsPrice: number } {
  const visibleOptions = customOptions.filter((option) => option.visible === EnableStatus.ENABLE);
  const optionsById = new Map(visibleOptions.map((option) => [option.id, option]));

  let inputs: OrderItemOptionInputDto[];
  let orphanSnapshots: SelectedOptionSnapshot[] = [];
  if (item.options !== undefined) {
    if (item.letteringMessage !== undefined || (item.imageUrls?.length ?? 0) > 0) {
      reject(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS, "options와 레거시 필드를 함께 전달");
    }
    inputs = item.options;
  } else {
    ({ inputs, orphanSnapshots } = convertLegacyInput(item, visibleOptions));
  }

  const snapshotsById = new Map<string, SelectedOptionSnapshot>();
  for (const input of inputs) {
    const option = optionsById.get(input.optionId);
    if (!option) {
      reject(
        ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION,
        `없거나 숨김인 추가 옵션 - ${input.optionId}`,
      );
    }
    if (snapshotsById.has(option.id)) {
      reject(ORDER_ERROR_MESSAGES.INVALID_OPTION_SELECTION, `추가 옵션 중복 - ${option.id}`);
    }
    const snapshot = normalizeOptionInput(option, input);
    if (snapshot) {
      snapshotsById.set(option.id, snapshot);
    }
  }

  const missingRequired = visibleOptions.find(
    (option) => option.required && !snapshotsById.has(option.id),
  );
  if (missingRequired) {
    reject(ORDER_ERROR_MESSAGES.REQUIRED_OPTION_MISSING, `필수 옵션 누락 - ${missingRequired.id}`);
  }

  const selectedOptions = [
    ...visibleOptions
      .map((option) => snapshotsById.get(option.id))
      .filter((snapshot): snapshot is SelectedOptionSnapshot => snapshot !== undefined),
    ...orphanSnapshots,
  ];
  return {
    selectedOptions,
    optionsPrice: selectedOptions.reduce((sum, snapshot) => sum + snapshot.price, 0),
  };
}

export function validateAndNormalizeOrderItem(
  item: CreateOrderItemDto,
  context: OrderItemNormalizeContext,
): NormalizedOrderItemForCreate {
  const { sizeOptionMap, flavorOptionMap, customOptions, baseSalePrice } = context;
  const hasSizePayload =
    item.sizeDisplayName !== undefined ||
    item.sizeLengthCm !== undefined ||
    item.sizeDescription !== undefined ||
    item.sizePrice !== undefined;
  const hasFlavorPayload = item.flavorDisplayName !== undefined || item.flavorPrice !== undefined;

  let selectedSize: {
    id: string;
    displayName: string;
    lengthCm?: number;
    description?: string;
    price: number;
  } | null = null;

  if (item.sizeId) {
    const matchedSize = sizeOptionMap.get(item.sizeId);
    if (!matchedSize || matchedSize.visible !== EnableStatus.ENABLE) {
      LoggerUtil.log(
        `주문 항목 검증 실패: 유효하지 않은 사이즈 옵션 - sizeId: ${item.sizeId}, visible: ${matchedSize?.visible}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
    }
    selectedSize = {
      id: matchedSize.id,
      displayName: matchedSize.displayName,
      lengthCm: matchedSize.lengthCm,
      description: matchedSize.description,
      price: matchedSize.price,
    };
  } else if (hasSizePayload) {
    LoggerUtil.log(
      `주문 항목 검증 실패: sizeId 없이 사이즈 정보 제공 - hasSizePayload: ${hasSizePayload}`,
    );
    throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
  } else if (hasVisible(sizeOptionMap.values())) {
    reject(ORDER_ERROR_MESSAGES.SIZE_REQUIRED, "노출 중인 사이즈가 있는데 sizeId 없음");
  }

  let selectedFlavor: { id: string; displayName: string; price: number } | null = null;
  if (item.flavorId) {
    const matchedFlavor = flavorOptionMap.get(item.flavorId);
    if (!matchedFlavor || matchedFlavor.visible !== EnableStatus.ENABLE) {
      LoggerUtil.log(
        `주문 항목 검증 실패: 유효하지 않은 맛 옵션 - flavorId: ${item.flavorId}, visible: ${matchedFlavor?.visible}`,
      );
      throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
    }
    selectedFlavor = {
      id: matchedFlavor.id,
      displayName: matchedFlavor.displayName,
      price: matchedFlavor.price,
    };
  } else if (hasFlavorPayload) {
    LoggerUtil.log(
      `주문 항목 검증 실패: flavorId 없이 맛 정보 제공 - hasFlavorPayload: ${hasFlavorPayload}`,
    );
    throw new BadRequestException(ORDER_ERROR_MESSAGES.INVALID_ORDER_ITEMS);
  } else if (hasVisible(flavorOptionMap.values())) {
    reject(ORDER_ERROR_MESSAGES.FLAVOR_REQUIRED, "노출 중인 맛이 있는데 flavorId 없음");
  }

  const { selectedOptions, optionsPrice } = normalizeSelectedOptions(item, customOptions);

  const itemPrice =
    baseSalePrice + (selectedSize?.price ?? 0) + (selectedFlavor?.price ?? 0) + optionsPrice;

  // 레거시 컬럼: 정리 단계 전까지 구버전 화면이 읽을 수 있게 첫 직접입력형·사진첨부형 값을 함께 기록
  const firstText = selectedOptions.find((snapshot) => snapshot.type === CustomOptionType.TEXT);
  const firstImage = selectedOptions.find((snapshot) => snapshot.type === CustomOptionType.IMAGE);

  return {
    sizeId: selectedSize?.id ?? null,
    sizeDisplayName: selectedSize?.displayName ?? null,
    sizeLengthCm: selectedSize?.lengthCm ?? null,
    sizeDescription: selectedSize?.description ?? null,
    sizePrice: selectedSize?.price ?? null,
    flavorId: selectedFlavor?.id ?? null,
    flavorDisplayName: selectedFlavor?.displayName ?? null,
    flavorPrice: selectedFlavor?.price ?? null,
    selectedOptions: selectedOptions as unknown as Prisma.InputJsonValue,
    optionsPrice,
    letteringMessage: firstText?.text ?? null,
    requestMessage: item.requestMessage ?? null,
    quantity: item.quantity,
    itemPrice,
    imageUrls: firstImage?.imageUrls ?? [],
  };
}
