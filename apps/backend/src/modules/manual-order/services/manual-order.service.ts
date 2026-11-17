import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { ManualOrder, Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { isAllowedUploadUrl } from "@apps/backend/modules/upload/utils/upload-url.util";
import {
  MANUAL_ORDER_ERROR_MESSAGES,
  MANUAL_ORDER_LIMITS,
} from "@apps/backend/modules/manual-order/constants/manual-order.constants";
import {
  ManualOrderDto,
  ManualOrderInputDto,
} from "@apps/backend/modules/manual-order/dto/manual-order.dto";
import { ymdDayDiff } from "@apps/backend/modules/manual-order/utils/manual-order-date.util";

/** 픽업 날·시각 순, 시각을 적지 않은 주문은 그날 맨 뒤 */
export const MANUAL_ORDER_ORDER_BY: Prisma.ManualOrderOrderByWithRelationInput[] = [
  { pickupDate: "asc" },
  { pickupTime: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
];

export function toManualOrderDto(row: ManualOrder): ManualOrderDto {
  return {
    id: row.id,
    storeId: row.storeId,
    pickupDate: row.pickupDate,
    pickupTime: row.pickupTime,
    cakeName: row.cakeName,
    lettering: row.lettering,
    price: row.price,
    paid: row.paid,
    customerName: row.customerName,
    source: row.source,
    memo: row.memo,
    photoUrls: row.photoUrls,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 직접 적은 주문(기획 I-42) 적기·고치기·지우기·기간으로 불러오기.
 * 사장님 본인 스토어만. Picake 주문(orders)과 다른 표라 알림톡·관리자 숫자·정산과 섞이지 않는다.
 */
@Injectable()
export class ManualOrderService {
  constructor(private readonly prisma: PrismaService) {}

  async assertStoreOwned(sellerId: string, storeId: string): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, sellerId },
      select: { id: true },
    });
    if (!store) throw new ForbiddenException(MANUAL_ORDER_ERROR_MESSAGES.STORE_NOT_OWNED);
  }

  async list(
    sellerId: string,
    storeId: string,
    startDate: string,
    endDate: string,
  ): Promise<ManualOrderDto[]> {
    const days = ymdDayDiff(startDate, endDate);
    if (days < 0 || days > MANUAL_ORDER_LIMITS.LIST_MAX_DAYS) {
      throw new BadRequestException(MANUAL_ORDER_ERROR_MESSAGES.INVALID_RANGE);
    }
    await this.assertStoreOwned(sellerId, storeId);
    const rows = await this.prisma.manualOrder.findMany({
      where: { storeId, pickupDate: { gte: startDate, lte: endDate } },
      orderBy: MANUAL_ORDER_ORDER_BY,
    });
    return rows.map(toManualOrderDto);
  }

  async get(sellerId: string, storeId: string, id: string): Promise<ManualOrderDto> {
    return toManualOrderDto(await this.findOwned(sellerId, storeId, id));
  }

  async create(
    sellerId: string,
    storeId: string,
    dto: ManualOrderInputDto,
  ): Promise<ManualOrderDto> {
    await this.assertStoreOwned(sellerId, storeId);
    const count = await this.prisma.manualOrder.count({ where: { storeId } });
    if (count >= MANUAL_ORDER_LIMITS.PER_STORE_MAX) {
      throw new BadRequestException(MANUAL_ORDER_ERROR_MESSAGES.TOO_MANY);
    }
    const row = await this.prisma.manualOrder.create({
      data: { storeId, ...this.toData(dto) },
    });
    return toManualOrderDto(row);
  }

  async update(
    sellerId: string,
    storeId: string,
    id: string,
    dto: ManualOrderInputDto,
  ): Promise<ManualOrderDto> {
    await this.findOwned(sellerId, storeId, id);
    const row = await this.prisma.manualOrder.update({ where: { id }, data: this.toData(dto) });
    return toManualOrderDto(row);
  }

  async setPaid(
    sellerId: string,
    storeId: string,
    id: string,
    paid: boolean | null,
  ): Promise<ManualOrderDto> {
    await this.findOwned(sellerId, storeId, id);
    const row = await this.prisma.manualOrder.update({ where: { id }, data: { paid } });
    return toManualOrderDto(row);
  }

  async remove(sellerId: string, storeId: string, id: string): Promise<void> {
    await this.findOwned(sellerId, storeId, id);
    await this.prisma.manualOrder.delete({ where: { id } });
  }

  private async findOwned(sellerId: string, storeId: string, id: string): Promise<ManualOrder> {
    const row = await this.prisma.manualOrder.findFirst({
      where: { id, storeId, store: { sellerId } },
    });
    if (!row) throw new NotFoundException(MANUAL_ORDER_ERROR_MESSAGES.NOT_FOUND);
    return row;
  }

  private toData(dto: ManualOrderInputDto) {
    const photoUrls = dto.photoUrls ?? [];
    if (photoUrls.some((url) => !isAllowedUploadUrl(url))) {
      // 업로드 API로 올린 사진만(다른 곳 주소가 저장되지 않게)
      throw new BadRequestException(MANUAL_ORDER_ERROR_MESSAGES.INVALID_PHOTO);
    }
    return {
      pickupDate: dto.pickupDate,
      pickupTime: dto.pickupTime ?? null,
      cakeName: dto.cakeName,
      lettering: dto.lettering ?? null,
      price: dto.price ?? null,
      paid: dto.paid ?? null,
      customerName: dto.customerName ?? null,
      source: dto.source,
      memo: dto.memo ?? null,
      photoUrls,
    };
  }
}
