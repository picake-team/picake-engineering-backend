import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  CUSTOM_OPTION_LIMITS,
  CustomOptionType,
  EnableStatus,
  PRODUCT_ERROR_MESSAGES,
  ProductCategoryType,
  ProductType,
  RESERVED_CUSTOM_OPTION_NAMES,
} from "@apps/backend/modules/product/constants/product.constants";
import { CustomOptionDto } from "@apps/backend/modules/product/dto/product-create.dto";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";

/** DB(products.custom_options)에 저장되는 선택지 */
export type CustomOptionChoice = {
  id: string;
  label: string;
  price: number;
  visible: EnableStatus;
};

/** DB(products.custom_options)에 저장되는 추가 옵션 */
export type CustomOption = {
  id: string;
  type: CustomOptionType;
  name: string;
  required: boolean;
  visible: EnableStatus;
  choices?: CustomOptionChoice[];
  maxSelect?: number;
  maxLength?: number;
  placeholder?: string;
  maxCount?: number;
};

const SELECT_TYPES: ReadonlySet<CustomOptionType> = new Set([
  CustomOptionType.SINGLE_SELECT,
  CustomOptionType.MULTI_SELECT,
]);

export function isSelectOptionType(type: CustomOptionType): boolean {
  return SELECT_TYPES.has(type);
}

function generateId(prefix: "opt" | "choice"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEnumValue<T extends Record<string, string>>(
  enumObject: T,
  value: unknown,
): value is T[keyof T] {
  return typeof value === "string" && (Object.values(enumObject) as string[]).includes(value);
}

/**
 * DB Json → CustomOption[] (형식이 깨진 항목은 버림)
 */
export function parseCustomOptions(raw: unknown): CustomOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const parsed: CustomOption[] = [];
  for (const candidate of raw) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !isEnumValue(CustomOptionType, candidate.type) ||
      typeof candidate.name !== "string" ||
      typeof candidate.required !== "boolean" ||
      !isEnumValue(EnableStatus, candidate.visible)
    ) {
      continue;
    }

    const option: CustomOption = {
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      required: candidate.required,
      visible: candidate.visible,
    };

    if (isSelectOptionType(option.type)) {
      option.choices = Array.isArray(candidate.choices)
        ? candidate.choices.filter(
            (choice): choice is CustomOptionChoice =>
              isRecord(choice) &&
              typeof choice.id === "string" &&
              typeof choice.label === "string" &&
              typeof choice.price === "number" &&
              isEnumValue(EnableStatus, choice.visible),
          )
        : [];
      if (typeof candidate.maxSelect === "number") option.maxSelect = candidate.maxSelect;
    }
    if (option.type === CustomOptionType.TEXT) {
      option.maxLength =
        typeof candidate.maxLength === "number"
          ? candidate.maxLength
          : CUSTOM_OPTION_LIMITS.MAX_TEXT_LENGTH;
      if (typeof candidate.placeholder === "string") option.placeholder = candidate.placeholder;
    }
    if (option.type === CustomOptionType.IMAGE) {
      option.maxCount =
        typeof candidate.maxCount === "number"
          ? candidate.maxCount
          : CUSTOM_OPTION_LIMITS.MAX_IMAGE_COUNT;
    }

    parsed.push(option);
  }
  return parsed;
}

function invalid(reason: string): never {
  LoggerUtil.log(`추가 옵션 검증 실패: ${reason}`);
  throw new BadRequestException(`${PRODUCT_ERROR_MESSAGES.CUSTOM_OPTION_INVALID} (${reason})`);
}

/**
 * 판매자가 보낸 추가 옵션을 저장 형태로 정규화하고 조합 규칙을 검증합니다.
 * - 기존에 있던 옵션·선택지 ID는 유지하고, 새 항목(또는 모르는 ID)에는 새 ID를 발급
 * - 형식과 맞지 않는 필드는 저장하지 않음
 */
export function normalizeCustomOptionsForSave(
  input: CustomOptionDto[],
  existingRaw: unknown,
): CustomOption[] {
  if (input.length > CUSTOM_OPTION_LIMITS.MAX_OPTIONS) {
    invalid(`옵션은 최대 ${CUSTOM_OPTION_LIMITS.MAX_OPTIONS}개까지 등록할 수 있습니다`);
  }

  const existingById = new Map(
    parseCustomOptions(existingRaw).map((option) => [option.id, option]),
  );
  const usedOptionIds = new Set<string>();
  const usedNames = new Set<string>();
  let imageOptionCount = 0;

  return input.map((dto) => {
    const name = dto.name.trim();
    if (!name) invalid("옵션명을 입력해주세요");
    if ((RESERVED_CUSTOM_OPTION_NAMES as readonly string[]).includes(name)) {
      invalid(`'${name}'은(는) 케이크 옵션에서 설정해주세요`);
    }
    if (usedNames.has(name)) invalid(`옵션명 '${name}'이(가) 중복됩니다`);
    usedNames.add(name);

    const existing =
      dto.id && existingById.has(dto.id) && !usedOptionIds.has(dto.id)
        ? existingById.get(dto.id)
        : undefined;
    const id = existing?.id ?? generateId("opt");
    usedOptionIds.add(id);

    const option: CustomOption = {
      id,
      type: dto.type,
      name,
      required: dto.required,
      visible: dto.visible,
    };

    if (isSelectOptionType(dto.type)) {
      const choicesInput = dto.choices ?? [];
      if (choicesInput.length === 0) invalid(`'${name}'에 옵션값을 1개 이상 추가해주세요`);
      if (choicesInput.length > CUSTOM_OPTION_LIMITS.MAX_CHOICES) {
        invalid(`'${name}'의 옵션값은 최대 ${CUSTOM_OPTION_LIMITS.MAX_CHOICES}개입니다`);
      }

      const existingChoiceIds = new Set((existing?.choices ?? []).map((choice) => choice.id));
      const usedChoiceIds = new Set<string>();
      const usedLabels = new Set<string>();
      option.choices = choicesInput.map((choiceDto) => {
        const label = choiceDto.label.trim();
        if (!label) invalid(`'${name}'에 비어 있는 옵션값이 있습니다`);
        if (usedLabels.has(label)) invalid(`'${name}'의 옵션값 '${label}'이(가) 중복됩니다`);
        usedLabels.add(label);

        const choiceId =
          choiceDto.id && existingChoiceIds.has(choiceDto.id) && !usedChoiceIds.has(choiceDto.id)
            ? choiceDto.id
            : generateId("choice");
        usedChoiceIds.add(choiceId);
        return { id: choiceId, label, price: choiceDto.price, visible: choiceDto.visible };
      });

      const visibleChoiceCount = option.choices.filter(
        (choice) => choice.visible === EnableStatus.ENABLE,
      ).length;
      if (option.required && option.visible === EnableStatus.ENABLE && visibleChoiceCount === 0) {
        invalid(`필수 옵션 '${name}'에 노출 중인 옵션값이 없어 주문할 수 없습니다`);
      }

      if (dto.type === CustomOptionType.MULTI_SELECT && dto.maxSelect !== undefined) {
        if (dto.maxSelect > option.choices.length) {
          invalid(`'${name}'의 최대 선택 개수가 옵션값 개수보다 많습니다`);
        }
        option.maxSelect = dto.maxSelect;
      }
    }

    if (dto.type === CustomOptionType.TEXT) {
      if (dto.maxLength === undefined) invalid(`'${name}'의 최대 글자 수를 입력해주세요`);
      option.maxLength = dto.maxLength;
      const placeholder = dto.placeholder?.trim();
      if (placeholder) option.placeholder = placeholder;
    }

    if (dto.type === CustomOptionType.IMAGE) {
      imageOptionCount += 1;
      if (imageOptionCount > CUSTOM_OPTION_LIMITS.MAX_IMAGE_OPTIONS) {
        invalid(
          `사진첨부형 옵션은 ${CUSTOM_OPTION_LIMITS.MAX_IMAGE_OPTIONS}개만 등록할 수 있습니다`,
        );
      }
      if (dto.maxCount === undefined) invalid(`'${name}'의 최대 사진 수를 입력해주세요`);
      option.maxCount = dto.maxCount;
    }

    return option;
  });
}

/**
 * 구매자 응답용: 숨김 옵션과 숨김 선택지를 제거합니다.
 */
export function toVisibleCustomOptions(raw: unknown): CustomOption[] {
  return parseCustomOptions(raw)
    .filter((option) => option.visible === EnableStatus.ENABLE)
    .map((option) =>
      option.choices
        ? {
            ...option,
            choices: option.choices.filter((choice) => choice.visible === EnableStatus.ENABLE),
          }
        : option,
    );
}

/**
 * 사이즈·맛처럼 visible을 가진 옵션 배열에 노출 항목이 1개 이상 있는지 확인
 */
export function hasVisibleOption(options: unknown): boolean {
  return (
    Array.isArray(options) &&
    options.some((option) => isRecord(option) && option.visible === EnableStatus.ENABLE)
  );
}

/**
 * 레거시 컬럼(letteringVisible·letteringMaxLength·imageUploadEnabled) 값을 추가 옵션에서 계산합니다.
 * 정리 단계 전까지 구버전 클라이언트가 같은 의미로 읽을 수 있게 함께 저장합니다.
 */
export function deriveLegacyOptionFields(options: CustomOption[]): {
  letteringVisible: EnableStatus;
  letteringMaxLength: number;
  imageUploadEnabled: EnableStatus;
} {
  const textOption = options.find(
    (option) => option.type === CustomOptionType.TEXT && option.visible === EnableStatus.ENABLE,
  );
  const imageOption = options.find(
    (option) => option.type === CustomOptionType.IMAGE && option.visible === EnableStatus.ENABLE,
  );
  return {
    letteringVisible: textOption ? EnableStatus.ENABLE : EnableStatus.DISABLE,
    letteringMaxLength: textOption?.maxLength ?? 0,
    imageUploadEnabled: imageOption ? EnableStatus.ENABLE : EnableStatus.DISABLE,
  };
}

/**
 * 카테고리 '커스텀'(LETTERING)을 상품 유형에 맞춥니다. 판매자가 직접 넣은 값은 무시합니다.
 */
export function syncCustomCategory(
  categories: ProductCategoryType[],
  productType: ProductType,
): ProductCategoryType[] {
  const withoutCustom = categories.filter((category) => category !== ProductCategoryType.LETTERING);
  return productType === ProductType.CUSTOM_CAKE
    ? [...withoutCustom, ProductCategoryType.LETTERING]
    : withoutCustom;
}

/**
 * 키 순서와 무관하게 비교할 수 있는 JSON 문자열 (옵션 변경 여부 판단용)
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
