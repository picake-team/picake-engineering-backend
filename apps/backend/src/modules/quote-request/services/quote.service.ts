import { randomBytes } from "crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Prisma,
  QuoteDeclineReason,
  QuoteRequestCloseReason,
  QuoteRequestStatus,
  QuoteRequestStoreAddedBy,
  QuoteSource,
} from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { isAllowedUploadUrl } from "@apps/backend/modules/upload/utils/upload-url.util";
import { ChatService } from "@apps/backend/modules/chat/services/chat.service";
import type {
  ChatMessagesDto,
  ChatMessagesQueryDto,
  ChatSendDto,
  ChatSendResultDto,
} from "@apps/backend/modules/chat/dto/chat.dto";
import {
  QUOTE_ERROR_MESSAGES,
  QUOTE_LIMITS,
  QUOTE_SIMILARITY_LABELS,
} from "@apps/backend/modules/quote-request/constants/quote.constants";
import {
  QUOTE_CAKE_SIZE_LABELS,
  QUOTE_REQUEST_ERROR_MESSAGES,
} from "@apps/backend/modules/quote-request/constants/quote-request.constants";
import type {
  AdminQuoteSectionDto,
  ChooseQuoteResponseDto,
  ConsumerQuoteSectionDto,
  QuoteDto,
  QuoteInputDto,
  QuoteLinkViewDto,
  QuoteRequestForShopDto,
} from "@apps/backend/modules/quote-request/dto/quote.dto";
import type { QuoteRequestStoreInputDto } from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import {
  canChoose,
  isAccepting,
  isStalled,
  linkChatOpenUntil,
  quoteTotal,
  rechooseUntil,
  targetState,
} from "@apps/backend/modules/quote-request/utils/quote-policy.util";
import {
  formatBudget,
  formatCake,
  formatKstDateTime,
  formatPickup,
} from "@apps/backend/modules/quote-request/utils/quote-request-label.util";
import { QuoteNotifyService } from "@apps/backend/modules/quote-request/services/quote-notify.service";

const QUOTE_SELECT = {
  id: true,
  source: true,
  unitPrice: true,
  priceMayVary: true,
  similarity: true,
  memo: true,
  photoUrls: true,
  editedAt: true,
  consumerSeenAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.QuoteSelect;

const TARGET_SELECT = {
  id: true,
  quoteRequestId: true,
  storeId: true,
  kakaoPlaceId: true,
  name: true,
  shopId: true,
  linkToken: true,
  linkCreatedAt: true,
  linkOpenedAt: true,
  sentToAppAt: true,
  declinedAt: true,
  declineReason: true,
  store: {
    select: {
      id: true,
      name: true,
      sellerId: true,
      logoImageUrl: true,
    },
  },
  quote: { select: QUOTE_SELECT },
} satisfies Prisma.QuoteRequestStoreSelect;

const REQUEST_SELECT = {
  id: true,
  consumerId: true,
  status: true,
  closeReason: true,
  closedAt: true,
  deadlineAt: true,
  chosenTargetId: true,
  chosenAt: true,
  chosenNotifiedAt: true,
  pickupDate: true,
  pickupHourFrom: true,
  pickupHourTo: true,
  pickupStartAt: true,
  onlyDesignatedStores: true,
  areaName: true,
  description: true,
  photoUrls: true,
  size: true,
  quantity: true,
  creams: true,
  flavorNote: true,
  budgetMin: true,
  budgetMax: true,
  requestNote: true,
  createdAt: true,
  _count: { select: { quotes: true } },
} satisfies Prisma.QuoteRequestSelect;

type TargetRow = Prisma.QuoteRequestStoreGetPayload<{ select: typeof TARGET_SELECT }>;
type RequestRow = Prisma.QuoteRequestGetPayload<{ select: typeof REQUEST_SELECT }>;
type TargetWithRequest = TargetRow & { quoteRequest: RequestRow };

/**
 * 가게 견적(기획 I-46 ②, 운영자 결정 2026-11-12).
 * 견적이 들어오는 길: 견적 링크(입점 전 가게, 가입 없이) · 판매자 앱 채팅의 요청서 카드(입점 가게) · 운영자 대신 적기.
 * 셋 다 같은 칸(금액·비슷한 정도·사진·메모)이고, 손님 화면에는 같은 견적 카드로 보인다.
 * 주문 받는 곳은 묻지 않는다(운영자 2026-11-12) — 손님이 고르면 채팅(입점 전 가게는 견적 링크 대화)에서 주문을 정한다.
 * 손님이 고르면 그 가게와의 채팅으로 이어진다(입점 전 가게는 견적 링크 안에서 대화).
 */
@Injectable()
export class QuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly chat: ChatService,
    private readonly notify: QuoteNotifyService,
  ) {}

  // ───────────────────────── 읽기 도우미 ─────────────────────────

  private async loadTarget(where: Prisma.QuoteRequestStoreWhereInput): Promise<TargetWithRequest> {
    const target = await this.prisma.quoteRequestStore.findFirst({
      where,
      select: { ...TARGET_SELECT, quoteRequest: { select: REQUEST_SELECT } },
    });
    if (!target) throw new NotFoundException(QUOTE_ERROR_MESSAGES.TARGET_NOT_FOUND);
    return target;
  }

  private storeName(t: TargetRow): string {
    return t.store?.name ?? t.name;
  }

  private toQuoteDto(t: TargetRow, quantity: number): QuoteDto | null {
    const q = t.quote;
    if (!q) return null;
    const sim = QUOTE_SIMILARITY_LABELS[q.similarity];
    return {
      id: q.id,
      targetId: t.id,
      storeName: this.storeName(t),
      storeId: t.storeId,
      isPicakeStore: !!t.storeId,
      logoImageUrl: t.store?.logoImageUrl ?? null,
      source: q.source,
      unitPrice: q.unitPrice,
      quantity,
      total: quoteTotal(q.unitPrice, quantity),
      priceMayVary: q.priceMayVary,
      similarity: q.similarity,
      similarityLabel: sim.label,
      similarityDetail: sim.detail,
      // 주문 받는 곳은 묻지 않음(11-12). 바뀌기 전 화면 호환용 빈 목록
      contacts: [],
      memo: q.memo,
      photoUrls: q.photoUrls,
      edited: !!q.editedAt,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    };
  }

  private stateOf(r: RequestRow, t: TargetRow, now: Date) {
    return targetState({
      request: r,
      targetId: t.id,
      declinedAt: t.declinedAt,
      hasQuote: !!t.quote,
      quoteCount: r._count.quotes,
      now,
    });
  }

  /** 가게 쪽(견적 링크·판매자 앱)에서 보는 요청서. 손님 이름·연락처는 넣지 않고 지역은 동네까지 */
  private forShop(t: TargetWithRequest, now: Date): QuoteRequestForShopDto {
    const r = t.quoteRequest;
    const state = this.stateOf(r, t, now);
    return {
      requestId: r.id,
      targetId: t.id,
      storeName: this.storeName(t),
      pickup: formatPickup(r),
      cake: formatCake(r),
      budget: formatBudget(r),
      area: r.areaName,
      deadline: formatKstDateTime(r.deadlineAt),
      deadlineAt: r.deadlineAt,
      quantity: r.quantity,
      description: r.description,
      requestNote: r.requestNote,
      photoUrls: r.photoUrls,
      state,
      // 어려워요로 답한 가게도 마감 전엔 견적으로 바꿀 수 있지만, 그사이 견적이 다 모였으면 보낼 수 없다
      canEdit:
        state === "OPEN" ||
        state === "SENT" ||
        (state === "DECLINED" && r._count.quotes < QUOTE_LIMITS.MAX_QUOTES),
      quote: this.toQuoteDto(t, r.quantity),
      declineReason: t.quote ? null : t.declineReason,
      prefillContacts: [],
    };
  }

  /** 이 가게의 채팅 가게 명부 줄(없으면 만든다) */
  private async ensureShop(t: TargetRow): Promise<string> {
    if (t.shopId) return t.shopId;
    const shopId = t.storeId
      ? await this.chat.shopIdForStore(t.storeId)
      : await this.chat.shopIdForUnentered({ kakaoPlaceId: t.kakaoPlaceId, name: t.name });
    await this.prisma.quoteRequestStore.update({ where: { id: t.id }, data: { shopId } });
    t.shopId = shopId;
    return shopId;
  }

  private requestCardSubtitle(r: RequestRow): string {
    return `${formatPickup(r)} · ${QUOTE_CAKE_SIZE_LABELS[r.size]} ${r.quantity}개 · 예산 ${formatBudget(r)}`;
  }

  // ───────────────────────── 견적 보내기(세 길 공통) ─────────────────────────

  private async submit(
    t: TargetWithRequest,
    dto: QuoteInputDto,
    source: QuoteSource,
    senderSellerId: string | null,
  ): Promise<QuoteDto> {
    const now = new Date();
    const r = t.quoteRequest;
    if (!isAccepting(r, now)) {
      throw new BadRequestException(
        r.chosenTargetId ? QUOTE_ERROR_MESSAGES.ALREADY_CHOSEN : QUOTE_ERROR_MESSAGES.NOT_ACCEPTING,
      );
    }
    const photoUrls = dto.photoUrls ?? [];
    if (
      photoUrls.length > QUOTE_LIMITS.MAX_PHOTOS ||
      photoUrls.some((u) => !isAllowedUploadUrl(u))
    ) {
      throw new BadRequestException(QUOTE_ERROR_MESSAGES.PHOTO_INVALID);
    }
    const data = {
      unitPrice: dto.unitPrice,
      priceMayVary: !!dto.priceMayVary,
      similarity: dto.similarity,
      memo: dto.memo?.trim() || null,
      photoUrls,
    };

    let edited = false;
    // 바로 앞에 고친(또는 보낸) 때. 연달아 고치면 손님 알림을 한 번만 보낸다
    const previousAt = t.quote ? (t.quote.editedAt ?? t.quote.createdAt) : null;
    if (t.quote) {
      t.quote = await this.prisma.quote.update({
        where: { id: t.quote.id },
        data: { ...data, editedAt: now, senderSellerId },
        select: QUOTE_SELECT,
      });
      edited = true;
    } else {
      const count = await this.prisma.quote.count({ where: { quoteRequestId: r.id } });
      if (count >= QUOTE_LIMITS.MAX_QUOTES) throw new ConflictException(QUOTE_ERROR_MESSAGES.FULL);
      try {
        t.quote = await this.prisma.quote.create({
          data: { ...data, quoteRequestId: r.id, targetId: t.id, source, senderSellerId },
          select: QUOTE_SELECT,
        });
      } catch (e) {
        // 같은 가게가 두 번 눌러 동시에 들어오면 하나만 남는다
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ConflictException("이미 견적을 보냈어요. 화면을 새로 고쳐 주세요.");
        }
        throw e;
      }
      r._count.quotes = count + 1;
    }
    if (t.declinedAt) {
      await this.prisma.quoteRequestStore.update({
        where: { id: t.id },
        data: { declinedAt: null, declineReason: null },
      });
      t.declinedAt = null;
      t.declineReason = null;
    }

    const quote = this.toQuoteDto(t, r.quantity)!;
    try {
      const shopId = await this.ensureShop(t);
      await this.chat.postQuoteCard({
        consumerId: r.consumerId,
        shopId,
        requestId: r.id,
        quoteId: quote.id,
        version: (t.quote!.editedAt ?? t.quote!.createdAt).getTime(),
        edited,
        senderSellerId,
        snapshot: {
          title: `${quote.storeName} 견적`,
          subtitle: `${quote.total.toLocaleString("ko-KR")}원 · ${quote.similarityLabel}`,
          // 가게 사진이 없으면 손님 요청서 사진(어느 요청의 견적인지 알아보게, 고름 카드와 같게)
          imageUrl: quote.photoUrls[0] ?? r.photoUrls[0] ?? null,
        },
      });
    } catch (e) {
      // 견적은 저장됐다. 채팅 카드가 빠져도 손님은 견적 화면에서 본다
      LoggerUtil.log(
        `[Quote] 채팅 카드 실패 request=${r.id}: ${e instanceof Error ? e.message : e}`,
      );
      SentryUtil.captureException(e, "warning", { module: "quote", operation: "chat-card" });
    }
    const quietEdit =
      edited &&
      !!previousAt &&
      now.getTime() - previousAt.getTime() < QUOTE_LIMITS.EDIT_NOTIFY_GAP_MINUTES * 60 * 1000;
    if (!quietEdit) {
      void this.notify.quoteArrived({
        requestId: r.id,
        storeName: quote.storeName,
        total: quote.total,
        edited,
      });
    }
    if (!edited && source !== QuoteSource.ADMIN) {
      void this.notify.ops("QUOTE_ARRIVED", r.id, quote.storeName);
    }
    return quote;
  }

  private async decline(t: TargetWithRequest, reason: QuoteDeclineReason): Promise<void> {
    const now = new Date();
    if (!isAccepting(t.quoteRequest, now)) {
      throw new BadRequestException(QUOTE_ERROR_MESSAGES.NOT_ACCEPTING);
    }
    if (t.quote) {
      throw new BadRequestException("견적을 이미 보냈어요. 금액을 고쳐서 보내 주세요.");
    }
    await this.prisma.quoteRequestStore.update({
      where: { id: t.id },
      data: { declinedAt: now, declineReason: reason },
    });
  }

  // ───────────────────────── 견적 링크(입점 전 가게, 가입 없이) ─────────────────────────

  private async targetByToken(token: string): Promise<TargetWithRequest> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      throw new NotFoundException(QUOTE_ERROR_MESSAGES.LINK_NOT_FOUND);
    }
    try {
      return await this.loadTarget({ linkToken: token });
    } catch {
      throw new NotFoundException(QUOTE_ERROR_MESSAGES.LINK_NOT_FOUND);
    }
  }

  async linkView(token: string): Promise<QuoteLinkViewDto> {
    const now = new Date();
    const t = await this.targetByToken(token);
    if (!t.linkOpenedAt) {
      await this.prisma.quoteRequestStore.update({
        where: { id: t.id },
        data: { linkOpenedAt: now },
      });
    }
    const r = t.quoteRequest;
    const chatOpenUntil = t.quote ? linkChatOpenUntil(r, t.id) : null;
    const threadId = t.shopId ? await this.chat.threadIdFor(r.consumerId, t.shopId) : null;
    return {
      ...this.forShop(t, now),
      showEntryGuide: !t.storeId,
      threadId,
      chatOpen: !!threadId && !!chatOpenUntil && chatOpenUntil.getTime() > now.getTime(),
      chatOpenUntil,
    };
  }

  async linkSubmit(token: string, dto: QuoteInputDto): Promise<QuoteDto> {
    const t = await this.targetByToken(token);
    return this.submit(t, dto, QuoteSource.LINK, null);
  }

  async linkDecline(token: string, reason: QuoteDeclineReason): Promise<void> {
    const t = await this.targetByToken(token);
    await this.decline(t, reason);
  }

  /** 링크에서 사진을 올려도 되나(받는 중이거나 대화가 열려 있을 때만) */
  async assertLinkCanUpload(token: string): Promise<void> {
    const now = new Date();
    const t = await this.targetByToken(token);
    const r = t.quoteRequest;
    const chatOpen = t.quote && linkChatOpenUntil(r, t.id).getTime() > now.getTime();
    if (!isAccepting(r, now) && !chatOpen) {
      throw new ForbiddenException(QUOTE_ERROR_MESSAGES.NOT_ACCEPTING);
    }
  }

  async linkMessages(token: string, query: ChatMessagesQueryDto): Promise<ChatMessagesDto | null> {
    const t = await this.targetByToken(token);
    if (!t.shopId || t.storeId) return null;
    // 링크는 요청 하나에 대한 것이라, 같은 손님이 이 가게에 다시 요청해도 이번 요청이 온 뒤 대화만 보인다(운영자 11-12)
    return this.chat.messagesForLink(
      { consumerId: t.quoteRequest.consumerId, shopId: t.shopId },
      query,
      t.quoteRequest.createdAt,
    );
  }

  async linkSend(token: string, dto: ChatSendDto): Promise<ChatSendResultDto> {
    const t = await this.targetByToken(token);
    if (!t.shopId || t.storeId) throw new BadRequestException(QUOTE_ERROR_MESSAGES.NOT_UNENTERED);
    return this.chat.sendForLink({ consumerId: t.quoteRequest.consumerId, shopId: t.shopId }, dto);
  }

  // ───────────────────────── 판매자 앱(입점 가게) ─────────────────────────

  private async targetForSeller(
    sellerId: string,
    storeId: string,
    requestId: string,
  ): Promise<TargetWithRequest> {
    const t = await this.loadTarget({ quoteRequestId: requestId, storeId });
    if (t.store?.sellerId !== sellerId) {
      throw new ForbiddenException("이 스토어의 견적 요청이 아니에요.");
    }
    return t;
  }

  async sellerView(
    sellerId: string,
    storeId: string,
    requestId: string,
  ): Promise<QuoteRequestForShopDto> {
    const t = await this.targetForSeller(sellerId, storeId, requestId);
    return this.forShop(t, new Date());
  }

  async sellerSubmit(
    sellerId: string,
    storeId: string,
    requestId: string,
    dto: QuoteInputDto,
  ): Promise<QuoteDto> {
    const t = await this.targetForSeller(sellerId, storeId, requestId);
    return this.submit(t, dto, QuoteSource.SELLER, sellerId);
  }

  async sellerDecline(
    sellerId: string,
    storeId: string,
    requestId: string,
    reason: QuoteDeclineReason,
  ): Promise<void> {
    const t = await this.targetForSeller(sellerId, storeId, requestId);
    await this.decline(t, reason);
  }

  /**
   * 입점 가게 채팅방에 요청서 카드를 넣는다(손님이 지정했거나 운영자가 더함). 받는 중일 때만, 한 번만.
   */
  private async sendToApp(t: TargetWithRequest): Promise<void> {
    const r = t.quoteRequest;
    if (!t.storeId || t.sentToAppAt || !isAccepting(r, new Date())) return;
    const shopId = await this.ensureShop(t);
    await this.chat.postQuoteRequestCard({
      consumerId: r.consumerId,
      shopId,
      requestId: r.id,
      snapshot: {
        title: "손님 견적 요청",
        subtitle: this.requestCardSubtitle(r),
        imageUrl: r.photoUrls[0] ?? null,
      },
    });
    await this.prisma.quoteRequestStore.update({
      where: { id: t.id },
      data: { sentToAppAt: new Date() },
    });
  }

  /** 새 요청서에서 손님이 지정한 입점 가게들의 판매자 앱으로 보낸다. 실패해도 요청은 그대로 */
  async sendNewRequestToApps(requestId: string): Promise<void> {
    const targets = await this.prisma.quoteRequestStore.findMany({
      where: { quoteRequestId: requestId, storeId: { not: null } },
      select: { ...TARGET_SELECT, quoteRequest: { select: REQUEST_SELECT } },
    });
    for (const t of targets) {
      try {
        await this.sendToApp(t);
      } catch (e) {
        LoggerUtil.log(
          `[Quote] 판매자 앱으로 보내기 실패 target=${t.id}: ${e instanceof Error ? e.message : e}`,
        );
        SentryUtil.captureException(e, "warning", { module: "quote", operation: "send-to-app" });
      }
    }
  }

  // ───────────────────────── 손님 ─────────────────────────

  private async chosenStalled(r: RequestRow, targets: TargetRow[], now: Date): Promise<boolean> {
    if (!r.chosenTargetId) return false;
    const chosen = targets.find((t) => t.id === r.chosenTargetId);
    if (!chosen?.shopId) return false;
    const thread = await this.prisma.chatThread.findUnique({
      where: { consumerId_shopId: { consumerId: r.consumerId, shopId: chosen.shopId } },
      select: { lastMessageSender: true, lastConsumerMessageAt: true },
    });
    return isStalled(thread, now);
  }

  /** 요청 상세에 붙는 견적들(SC-18). 열면 새 견적을 본 것으로 적는다 */
  async consumerSection(consumerId: string, requestId: string): Promise<ConsumerQuoteSectionDto> {
    const now = new Date();
    const r = await this.prisma.quoteRequest.findFirst({
      where: { id: requestId, consumerId },
      select: {
        ...REQUEST_SELECT,
        stores: { select: TARGET_SELECT, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!r) throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    const stalled = await this.chosenStalled(r, r.stores, now);
    const withQuote = r.stores
      .filter((t) => t.quote)
      .sort((a, b) => a.quote!.createdAt.getTime() - b.quote!.createdAt.getTime());
    const threadIds = await this.chat.threadIdsFor(
      consumerId,
      withQuote.map((t) => t.shopId).filter((v): v is string => !!v),
    );
    const quotes = withQuote.map((t) => ({
      ...this.toQuoteDto(t, r.quantity)!,
      unseen: !t.quote!.consumerSeenAt,
      chosen: r.chosenTargetId === t.id,
      canChoose: canChoose(r, t.id, now, stalled),
      threadId: (t.shopId && threadIds.get(t.shopId)) ?? null,
    }));
    if (withQuote.some((t) => !t.quote!.consumerSeenAt)) {
      await this.prisma.quote.updateMany({
        where: { quoteRequestId: r.id, consumerSeenAt: null },
        data: { consumerSeenAt: now },
      });
    }
    return {
      quotes,
      declined: r.stores
        .filter((t) => !t.quote && t.declinedAt)
        .map((t) => ({ targetId: t.id, storeName: this.storeName(t) })),
      askedCount: r.stores.filter(
        (t) => t.linkCreatedAt || t.sentToAppAt || t.quote || t.declinedAt,
      ).length,
      chosenTargetId: r.chosenTargetId,
      chosenAt: r.chosenAt,
      rechooseUntil: rechooseUntil(r),
    };
  }

  /** 손님이 아직 보지 않은 견적 수(요청별) */
  async unseenCounts(
    consumerId: string,
    requestIds: string[],
  ): Promise<Map<string, { total: number; unseen: number }>> {
    const map = new Map<string, { total: number; unseen: number }>();
    if (requestIds.length === 0) return map;
    const rows = await this.prisma.quote.findMany({
      where: { quoteRequestId: { in: requestIds }, quoteRequest: { consumerId } },
      select: { quoteRequestId: true, consumerSeenAt: true },
    });
    for (const q of rows) {
      const cur = map.get(q.quoteRequestId) ?? { total: 0, unseen: 0 };
      cur.total += 1;
      if (!q.consumerSeenAt) cur.unseen += 1;
      map.set(q.quoteRequestId, cur);
    }
    return map;
  }

  /** 손님 MY "내 견적"의 아직 보지 않은 견적 수 */
  async unseenTotal(consumerId: string): Promise<number> {
    return this.prisma.quote.count({
      where: { consumerSeenAt: null, quoteRequest: { consumerId } },
    });
  }

  /**
   * 이 가게로 고르기. 고르면 "가게 연결"이 되고 그 가게와의 채팅으로 이어진다.
   * 고른 뒤 24시간 안(또는 고른 가게가 24시간 답이 없을 때)에는 다른 견적으로 바꿀 수 있다.
   */
  async choose(
    consumerId: string,
    requestId: string,
    quoteId: string,
  ): Promise<ChooseQuoteResponseDto> {
    const now = new Date();
    const r = await this.prisma.quoteRequest.findFirst({
      where: { id: requestId, consumerId },
      select: { ...REQUEST_SELECT, stores: { select: TARGET_SELECT } },
    });
    if (!r) throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    const target = r.stores.find((t) => t.quote?.id === quoteId);
    if (!target) throw new NotFoundException(QUOTE_ERROR_MESSAGES.QUOTE_NOT_FOUND);
    const stalled = await this.chosenStalled(r, r.stores, now);
    if (!canChoose(r, target.id, now, stalled)) {
      throw new BadRequestException(QUOTE_ERROR_MESSAGES.CANNOT_CHOOSE);
    }
    // 동시에 두 번 누르거나 그사이 마감되면 하나만 반영
    const { count } = await this.prisma.quoteRequest.updateMany({
      where: {
        id: r.id,
        consumerId,
        status: r.status,
        chosenTargetId: r.chosenTargetId,
        deadlineAt: { gt: now },
      },
      data: {
        status: QuoteRequestStatus.CONNECTED,
        chosenTargetId: target.id,
        chosenAt: now,
        chosenNotifiedAt: null,
        stallAlertedAt: null,
      },
    });
    if (count === 0) throw new ConflictException(QUOTE_ERROR_MESSAGES.CANNOT_CHOOSE);

    const storeName = this.storeName(target);
    const total = quoteTotal(target.quote!.unitPrice, r.quantity);
    const shopId = await this.ensureShop(target);
    const otherShopIds = r.stores
      .filter((t) => t.id !== target.id && t.shopId)
      .map((t) => t.shopId as string);
    const threadId = await this.chat.postChosenCards({
      consumerId,
      requestId: r.id,
      chosenShopId: shopId,
      otherShopIds,
      snapshot: {
        title: "이 견적을 골랐어요",
        subtitle: `${storeName} · ${total.toLocaleString("ko-KR")}원`,
        imageUrl: r.photoUrls[0] ?? null,
      },
    });
    if (!target.storeId) void this.notify.ops("CHOSEN_UNENTERED", r.id, storeName);
    // 답하지 않은 다른 가게의 요청서 카드는 "답할 것"에서 뺀다
    await this.retireRequestCards(r.id);
    return { requestId: r.id, targetId: target.id, threadId };
  }

  // ───────────────────────── 관리자 ─────────────────────────

  private linkUrl(token: string | null): string | null {
    if (!token) return null;
    const base = (this.configService.get<string>("PUBLIC_USER_DOMAIN") ?? "").replace(/\/+$/, "");
    return `${base}/q/${token}`;
  }

  async adminSection(requestId: string): Promise<AdminQuoteSectionDto> {
    const now = new Date();
    const r = await this.prisma.quoteRequest.findUnique({
      where: { id: requestId },
      select: {
        ...REQUEST_SELECT,
        stores: { select: TARGET_SELECT, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!r) throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    const shopIds = r.stores.map((t) => t.shopId).filter((v): v is string => !!v);
    const threads = shopIds.length
      ? await this.prisma.chatThread.findMany({
          where: { consumerId: r.consumerId, shopId: { in: shopIds } },
          select: { shopId: true, lastMessageSender: true, lastConsumerMessageAt: true },
        })
      : [];
    const byShop = new Map(threads.map((th) => [th.shopId, th]));
    const chosen = r.stores.find((t) => t.id === r.chosenTargetId) ?? null;
    return {
      targets: r.stores.map((t) => {
        const th = t.shopId ? byShop.get(t.shopId) : undefined;
        return {
          targetId: t.id,
          linkUrl: this.linkUrl(t.linkToken),
          linkCreatedAt: t.linkCreatedAt,
          linkOpenedAt: t.linkOpenedAt,
          sentToAppAt: t.sentToAppAt,
          state: this.stateOf(r, t, now),
          quote: this.toQuoteDto(t, r.quantity),
          declineReason: t.quote ? null : t.declineReason,
          hasChat: !!th,
          awaitingShopReply: th?.lastMessageSender === "CONSUMER",
        };
      }),
      chosenTargetId: r.chosenTargetId,
      chosenAt: r.chosenAt,
      chosenNotifiedAt: r.chosenNotifiedAt,
      chosenIsUnentered: !!chosen && !chosen.storeId,
      chosenStalled: await this.chosenStalled(r, r.stores, now),
    };
  }

  /** 운영자 "가게 추가"(지도 검색·Picake 가게·이름만). 입점 가게면 판매자 앱으로 바로 보낸다 */
  async adminAddTarget(
    requestId: string,
    dto: QuoteRequestStoreInputDto,
  ): Promise<AdminQuoteSectionDto> {
    const r = await this.prisma.quoteRequest.findUnique({
      where: { id: requestId },
      select: { id: true, onlyDesignatedStores: true, stores: { select: { sortOrder: true } } },
    });
    if (!r) throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    if (r.onlyDesignatedStores)
      throw new BadRequestException(QUOTE_ERROR_MESSAGES.ONLY_STORE_REQUEST);
    const name = dto.name?.trim();
    let data: Prisma.QuoteRequestStoreUncheckedCreateInput;
    const sortOrder = Math.max(-1, ...r.stores.map((s) => s.sortOrder)) + 1;
    if (dto.storeId) {
      const s = await this.prisma.store.findUnique({
        where: { id: dto.storeId },
        select: {
          id: true,
          name: true,
          roadAddress: true,
          address: true,
          latitude: true,
          longitude: true,
          phoneNumber: true,
        },
      });
      if (!s) throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.STORE_NOT_FOUND);
      data = {
        quoteRequestId: r.id,
        addedBy: QuoteRequestStoreAddedBy.ADMIN,
        sortOrder,
        storeId: s.id,
        name: s.name,
        address: s.roadAddress ?? s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        phone: s.phoneNumber,
      };
    } else {
      if (!name) throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.STORE_TARGET_INVALID);
      data = {
        quoteRequestId: r.id,
        addedBy: QuoteRequestStoreAddedBy.ADMIN,
        sortOrder,
        kakaoPlaceId: dto.kakaoPlaceId ?? null,
        name,
        address: dto.address ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        phone: dto.phone ?? null,
        placeUrl: dto.placeUrl ?? null,
      };
    }
    let createdId: string;
    try {
      createdId = (await this.prisma.quoteRequestStore.create({ data, select: { id: true } })).id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException(QUOTE_ERROR_MESSAGES.STORE_ALREADY_ADDED);
      }
      throw e;
    }
    if (dto.storeId) {
      const t = await this.loadTarget({ id: createdId });
      await this.sendToApp(t);
    }
    return this.adminSection(requestId);
  }

  /** 그 가게만의 견적 링크(없으면 만든다) */
  async adminCreateLink(requestId: string, targetId: string): Promise<{ linkUrl: string }> {
    const t = await this.loadTarget({ id: targetId, quoteRequestId: requestId });
    if (t.storeId) throw new BadRequestException(QUOTE_ERROR_MESSAGES.NOT_UNENTERED);
    let token = t.linkToken;
    if (!token) {
      token = randomBytes(QUOTE_LIMITS.LINK_TOKEN_BYTES).toString("base64url");
      await this.prisma.quoteRequestStore.update({
        where: { id: t.id },
        data: { linkToken: token, linkCreatedAt: new Date() },
      });
      await this.ensureShop(t);
    }
    return { linkUrl: this.linkUrl(token)! };
  }

  async adminSubmit(requestId: string, targetId: string, dto: QuoteInputDto): Promise<QuoteDto> {
    const t = await this.loadTarget({ id: targetId, quoteRequestId: requestId });
    return this.submit(t, dto, QuoteSource.ADMIN, null);
  }

  async adminDecline(
    requestId: string,
    targetId: string,
    reason: QuoteDeclineReason,
  ): Promise<void> {
    const t = await this.loadTarget({ id: targetId, quoteRequestId: requestId });
    await this.decline(t, reason);
  }

  /** 입점 전 가게를 고른 요청: 운영자가 그 가게에 DM으로 알린 뒤 누른다 */
  async adminMarkChosenNotified(requestId: string): Promise<void> {
    const r = await this.prisma.quoteRequest.findUnique({
      where: { id: requestId },
      select: { chosenTargetId: true, stores: { select: { id: true, storeId: true } } },
    });
    if (!r) throw new NotFoundException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_FOUND);
    const chosen = r.stores.find((t) => t.id === r.chosenTargetId);
    if (!chosen || chosen.storeId) {
      throw new BadRequestException(QUOTE_ERROR_MESSAGES.NOT_CHOSEN_UNENTERED);
    }
    await this.prisma.quoteRequest.update({
      where: { id: requestId },
      data: { chosenNotifiedAt: new Date() },
    });
  }

  /** 운영자 "요청 마감하기"(장난·받을 수 없는 요청). 받는 중일 때만 */
  async adminClose(requestId: string): Promise<void> {
    const { count } = await this.prisma.quoteRequest.updateMany({
      where: { id: requestId, status: QuoteRequestStatus.OPEN, chosenTargetId: null },
      data: {
        status: QuoteRequestStatus.CLOSED,
        closeReason: QuoteRequestCloseReason.ADMIN,
        closedAt: new Date(),
      },
    });
    if (count === 0) throw new BadRequestException(QUOTE_REQUEST_ERROR_MESSAGES.NOT_OPEN);
    await this.retireRequestCards(requestId);
  }

  /** 요청이 끝나면(마감·닫힘·고름) 답하지 않은 요청서 카드 방을 사장님 "답할 것"에서 뺀다. 실패해도 던지지 않는다 */
  async retireRequestCards(requestId: string): Promise<void> {
    try {
      await this.chat.retireQuoteRequestCards(requestId);
    } catch (e) {
      LoggerUtil.log(
        `[Quote] 요청서 카드 정리 실패 request=${requestId}: ${e instanceof Error ? e.message : e}`,
      );
      SentryUtil.captureException(e, "warning", { module: "quote", operation: "retire-cards" });
    }
  }
}
