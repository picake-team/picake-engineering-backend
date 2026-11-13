import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, QuoteRequestStatus } from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { calculatePaginationMeta } from "@apps/backend/common/utils/pagination.util";
import { QUOTE_REQUEST_ERROR_MESSAGES } from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import {
  QuoteRequestDetailDto,
  QuoteRequestListQueryDto,
  QuoteRequestListResponseDto,
} from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import {
  AdminQuoteRequestDetailDto,
  AdminQuoteRequestListQueryDto,
  AdminQuoteRequestListResponseDto,
} from "@apps/backend/modules/quote-request/dto/quote-request-admin.dto";
import {
  ADMIN_QUOTE_REQUEST_SELECT,
  QUOTE_REQUEST_SELECT,
  adminStatusWhere,
  consumerInProgressWhere,
  toAdminDetail,
  toAdminListItem,
  toDetail,
  toListItem,
} from "@apps/backend/modules/quote-request/utils/quote-request-mapper.util";

/**
 * 견적 요청 읽기: 손님 "내 견적 요청"(SC-17)·요청 상세(SC-18), 관리자 목록·상세(SC-45·46)
 */
@Injectable()
export class QuoteRequestReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** 진행 중(픽업이 가까운 순) / 지난 요청(최근 픽업 순) */
  async listForConsumer(
    consumerId: string,
    query: QuoteRequestListQueryDto,
    now: Date = new Date(),
  ): Promise<QuoteRequestListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const ongoing: Prisma.QuoteRequestWhereInput = { consumerId, ...consumerInProgressWhere(now) };
    const past: Prisma.QuoteRequestWhereInput = { consumerId, NOT: consumerInProgressWhere(now) };
    const isOngoing = (query.tab ?? "ONGOING") === "ONGOING";
    const where = isOngoing ? ongoing : past;

    const [rows, ongoingCount, pastCount] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        where,
        select: QUOTE_REQUEST_SELECT,
        orderBy: [{ pickupStartAt: isOngoing ? "asc" : "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.quoteRequest.count({ where: ongoing }),
      this.prisma.quoteRequest.count({ where: past }),
    ]);

    return {
      data: rows.map((row) => toListItem(row, now)),
      meta: calculatePaginationMeta(page, limit, isOngoing ? ongoingCount : pastCount),
      counts: { ongoing: ongoingCount, past: pastCount },
    };
  }

  async getForConsumer(
    consumerId: string,
    requestId: string,
    now: Date = new Date(),
  ): Promise<QuoteRequestDetailDto> {
    const row = await this.prisma.quoteRequest.findFirst({
      where: { id: requestId, consumerId },
      select: QUOTE_REQUEST_SELECT,
    });
    if (!row) {
      throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    }
    return toDetail(row, now);
  }

  /** 관리자 목록: 견적 받는 중은 마감이 가까운 순, 나머지는 최신 요청순 */
  async listForAdmin(
    query: AdminQuoteRequestListQueryDto,
    now: Date = new Date(),
  ): Promise<AdminQuoteRequestListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = adminStatusWhere(query.status, now);
    const orderBy: Prisma.QuoteRequestOrderByWithRelationInput[] =
      query.status === QuoteRequestStatus.OPEN
        ? [{ deadlineAt: "asc" }, { createdAt: "asc" }]
        : [{ createdAt: "desc" }];

    const [rows, totalItems] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        where,
        select: ADMIN_QUOTE_REQUEST_SELECT,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.quoteRequest.count({ where }),
    ]);

    return {
      data: rows.map((row) => toAdminListItem(row, now)),
      meta: calculatePaginationMeta(page, limit, totalItems),
    };
  }

  async getForAdmin(
    requestId: string,
    now: Date = new Date(),
  ): Promise<AdminQuoteRequestDetailDto> {
    const row = await this.prisma.quoteRequest.findUnique({
      where: { id: requestId },
      select: ADMIN_QUOTE_REQUEST_SELECT,
    });
    if (!row) {
      throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    }
    return toAdminDetail(row, now);
  }
}
