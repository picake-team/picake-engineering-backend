import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  QuoteRequestCloseReason,
  QuoteRequestStatus,
  QuoteRequestStoreAddedBy,
} from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { isAllowedUploadUrl } from "@apps/backend/modules/upload/utils/upload-url.util";
import {
  QUOTE_REQUEST_ERROR_MESSAGES,
  QUOTE_REQUEST_LIMITS,
} from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import {
  CreateQuoteRequestDto,
  CreateQuoteRequestResponseDto,
  QuoteRequestStoreInputDto,
} from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import { resolvePickupWindow } from "@apps/backend/modules/quote-request/utils/quote-request-time.util";
import {
  QUOTE_REQUEST_SELECT,
  effectiveStatus,
  ongoingWhere,
} from "@apps/backend/modules/quote-request/utils/quote-request-mapper.util";
import { QuoteRequestOpsAlertService } from "@apps/backend/modules/quote-request/services/quote-request-ops-alert.service";

type StoreSnapshot = Omit<Prisma.QuoteRequestStoreCreateManyQuoteRequestInput, "id" | "createdAt">;

/**
 * 견적 요청 쓰기(손님): 요청서 보내기, 요청 닫기
 */
@Injectable()
export class QuoteRequestWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opsAlert: QuoteRequestOpsAlertService,
  ) {}

  async createForConsumer(
    consumerId: string,
    dto: CreateQuoteRequestDto,
    now: Date = new Date(),
  ): Promise<CreateQuoteRequestResponseDto> {
    const window = resolvePickupWindow(dto, now);
    if (!window.ok) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES[window.error]);
    }

    const description = dto.description?.trim() || null;
    const photoUrls = dto.photoUrls ?? [];
    if (!description && photoUrls.length === 0) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.PHOTO_OR_DESCRIPTION_REQUIRED);
    }
    if (photoUrls.some((url) => !isAllowedUploadUrl(url))) {
      throw new BadRequestException("참고 사진은 업로드한 사진만 넣을 수 있어요.");
    }

    const { budgetMin, budgetMax } = this.normalizeBudget(dto.budgetMin, dto.budgetMax);
    const area = this.resolveArea(dto);
    const stores = await this.resolveStores(dto.stores ?? []);
    if (area.onlyDesignatedStores && stores.length !== 1) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.ONLY_STORE_NEEDS_ONE);
    }

    const openCount = await this.prisma.quoteRequest.count({
      where: { consumerId, ...ongoingWhere(now) },
    });
    if (openCount >= QUOTE_REQUEST_LIMITS.MAX_OPEN_PER_CONSUMER) {
      throw new ConflictException(QUOTE_REQUEST_ERROR_MESSAGES.TOO_MANY_OPEN);
    }

    const created = await this.prisma.quoteRequest.create({
      data: {
        consumerId,
        pickupDate: dto.pickupDate,
        pickupHourFrom: dto.pickupHourFrom ?? null,
        pickupHourTo: dto.pickupHourTo ?? null,
        pickupStartAt: window.pickupStartAt,
        deadlineAt: window.deadlineAt,
        ...area,
        description,
        photoUrls,
        size: dto.size,
        quantity: dto.quantity,
        creams: [...new Set(dto.creams ?? [])],
        flavorNote: dto.flavorNote?.trim() || null,
        budgetMin,
        budgetMax,
        requestNote: dto.requestNote?.trim() || null,
        entry: dto.entry ?? null,
        consentedAt: now,
        stores: { createMany: { data: stores } },
      },
      select: QUOTE_REQUEST_SELECT,
    });

    // 운영자 알림은 기다리지 않는다(실패해도 요청은 저장됨)
    void this.opsAlert.notifyNewRequest(created);

    return { id: created.id, pickupStartAt: created.pickupStartAt, deadlineAt: created.deadlineAt };
  }

  /** 손님이 "요청 닫기"(되돌릴 수 없음). 견적 받는 중일 때만 */
  async closeForConsumer(
    consumerId: string,
    requestId: string,
    now: Date = new Date(),
  ): Promise<void> {
    const row = await this.prisma.quoteRequest.findFirst({
      where: { id: requestId, consumerId },
      select: { id: true, status: true, closeReason: true, deadlineAt: true },
    });
    if (!row) {
      throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    }
    if (effectiveStatus(row, now).status !== QuoteRequestStatus.OPEN) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_OPEN);
    }

    // 동시에 마감 처리된 경우를 막으려고 OPEN일 때만 바꾼다
    const { count } = await this.prisma.quoteRequest.updateMany({
      where: { id: requestId, consumerId, status: QuoteRequestStatus.OPEN },
      data: {
        status: QuoteRequestStatus.CLOSED,
        closeReason: QuoteRequestCloseReason.CONSUMER,
        closedAt: now,
      },
    });
    if (count === 0) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_OPEN);
    }
  }

  /** 예산: 1만원~10만원, 1만원 단위. 최대가 없거나 10만원이면 "10만원 이상" */
  private normalizeBudget(min: number, max?: number | null) {
    const { BUDGET_MIN, BUDGET_MAX, BUDGET_STEP } = QUOTE_REQUEST_LIMITS;
    const onStep = (v: number) => v % BUDGET_STEP === 0 && v >= BUDGET_MIN && v <= BUDGET_MAX;
    if (!onStep(min)) throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.BUDGET_INVALID);
    if (max === undefined || max === null || max === BUDGET_MAX) {
      return { budgetMin: min, budgetMax: null };
    }
    if (!onStep(max) || max < min) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.BUDGET_INVALID);
    }
    return { budgetMin: min, budgetMax: max };
  }

  /** 받을 동네와 거리. "이 가게에만"이면 저장하지 않는다 */
  private resolveArea(dto: CreateQuoteRequestDto) {
    if (dto.onlyDesignatedStores) {
      return {
        onlyDesignatedStores: true,
        areaName: null,
        areaSido: null,
        areaLatitude: null,
        areaLongitude: null,
        distanceKm: null,
      };
    }

    const areaName = dto.areaName?.trim();
    if (!areaName || dto.areaLatitude === undefined || dto.areaLongitude === undefined) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.AREA_REQUIRED);
    }
    const hasKm = dto.distanceKm !== undefined && dto.distanceKm !== null;
    if (hasKm === Boolean(dto.wholeSido)) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.DISTANCE_REQUIRED);
    }
    const areaSido = dto.areaSido?.trim() || null;
    if (dto.wholeSido && !areaSido) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.SIDO_REQUIRED);
    }

    return {
      onlyDesignatedStores: false,
      areaName,
      areaSido,
      areaLatitude: dto.areaLatitude,
      areaLongitude: dto.areaLongitude,
      distanceKm: hasKm ? dto.distanceKm! : null,
    };
  }

  /** 넣은 가게를 저장할 모양으로. Picake 가게는 지금 가게 정보로 이름·주소를 채운다 */
  private async resolveStores(inputs: QuoteRequestStoreInputDto[]): Promise<StoreSnapshot[]> {
    const storeIds: string[] = [];
    const placeIds: string[] = [];
    for (const input of inputs) {
      const hasStore = Boolean(input.storeId);
      const hasPlace = Boolean(input.kakaoPlaceId);
      if (hasStore === hasPlace || (hasPlace && !input.name?.trim())) {
        throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.STORE_TARGET_INVALID);
      }
      if (hasStore) storeIds.push(input.storeId!);
      else placeIds.push(input.kakaoPlaceId!);
    }
    if (new Set(storeIds).size !== storeIds.length || new Set(placeIds).size !== placeIds.length) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.DUPLICATE_STORE);
    }

    const found = storeIds.length
      ? await this.prisma.store.findMany({
          where: { id: { in: storeIds } },
          select: {
            id: true,
            name: true,
            roadAddress: true,
            address: true,
            latitude: true,
            longitude: true,
            phoneNumber: true,
          },
        })
      : [];
    if (found.length !== storeIds.length) {
      throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.STORE_NOT_FOUND);
    }
    const byId = new Map(found.map((s) => [s.id, s]));

    return inputs.map((input, sortOrder) => {
      if (input.storeId) {
        const s = byId.get(input.storeId)!;
        return {
          addedBy: QuoteRequestStoreAddedBy.CONSUMER,
          sortOrder,
          storeId: s.id,
          kakaoPlaceId: null,
          name: s.name,
          address: s.roadAddress ?? s.address,
          latitude: s.latitude,
          longitude: s.longitude,
          phone: s.phoneNumber,
          placeUrl: null,
        };
      }
      return {
        addedBy: QuoteRequestStoreAddedBy.CONSUMER,
        sortOrder,
        storeId: null,
        kakaoPlaceId: input.kakaoPlaceId!,
        name: input.name!.trim(),
        address: input.address ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        phone: input.phone ?? null,
        placeUrl: input.placeUrl ?? null,
      };
    });
  }
}
