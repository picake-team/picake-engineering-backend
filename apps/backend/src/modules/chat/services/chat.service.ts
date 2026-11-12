import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { isAllowedUploadUrl } from "@apps/backend/modules/upload/utils/upload-url.util";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { EnableStatus } from "@apps/backend/modules/product/constants/product.constants";
import { formatKstDate } from "@apps/backend/modules/quote-request/utils/quote-request-label.util";
import {
  CHAT_ERROR_MESSAGES,
  CHAT_LIMITS,
  CHAT_QUOTE_PREVIEWS,
  CHAT_RULES_VERSION,
} from "@apps/backend/modules/chat/constants/chat.constants";
import {
  linkChatOpenUntil,
  targetState,
} from "@apps/backend/modules/quote-request/utils/quote-policy.util";
import {
  ChatListQueryDto,
  ChatMessageDto,
  ChatMessagesDto,
  ChatMessagesQueryDto,
  ChatReportDto,
  ChatSendDto,
  ChatSendResultDto,
  ChatThreadDetailDto,
  ChatThreadDto,
  ChatThreadListDto,
  ChatUnreadDto,
  ChatExistingThreadDto,
  ChatWriteStateDto,
  ConsumerStartChatDto,
} from "@apps/backend/modules/chat/dto/chat.dto";
import {
  buildPreview,
  decideConsumerWrite,
  decideShopWrite,
  isUnreadFor,
  maskBlockedWords,
} from "@apps/backend/modules/chat/utils/chat-policy.util";
import { ChatNotifyService } from "@apps/backend/modules/chat/services/chat-notify.service";
import { SELLER_QUOTE_PUSH_TITLES } from "@apps/backend/modules/quote-request/constants/quote.constants";
import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";

type Side = "CONSUMER" | "SHOP";

/** 픽업 전 예약(사장님이 먼저 채팅할 수 있는 주문) */
export const CHAT_ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.RESERVATION_REQUESTED,
  OrderStatus.PAYMENT_PENDING,
  OrderStatus.PAYMENT_COMPLETED,
  OrderStatus.CONFIRMED,
  OrderStatus.PICKUP_PENDING,
];

const THREAD_SELECT = {
  id: true,
  consumerId: true,
  shopId: true,
  lastMessageAt: true,
  lastMessageSender: true,
  lastMessagePreview: true,
  lastConsumerMessageAt: true,
  consumerReadAt: true,
  shopReadAt: true,
  consumerSeenAt: true,
  shopSeenAt: true,
  consumerMuted: true,
  shopMuted: true,
  blockedByConsumerAt: true,
  blockedByShopAt: true,
  consumerListedAt: true,
  shopLockedAt: true,
  consumer: { select: { nickname: true, withdrawnAt: true } },
  shop: {
    select: {
      id: true,
      name: true,
      storeId: true,
      unentered: true,
      store: { select: { id: true, name: true, logoImageUrl: true, sellerId: true } },
    },
  },
} satisfies Prisma.ChatThreadSelect;

type ThreadRow = Prisma.ChatThreadGetPayload<{ select: typeof THREAD_SELECT }>;

type MessageKind =
  | "TEXT"
  | "IMAGE"
  | "ORDER"
  | "PRODUCT"
  | "QUOTE_REQUEST"
  | "QUOTE"
  | "QUOTE_CHOSEN";

type MessageRow = {
  id: string;
  clientId: string;
  sender: "CONSUMER" | "SHOP" | "SYSTEM";
  kind: MessageKind;
  text: string | null;
  maskedText: string | null;
  imageUrls: string[];
  refOrderId: string | null;
  refProductId: string | null;
  refQuoteRequestId: string | null;
  cardSnapshot: Prisma.JsonValue | null;
  hiddenAt: Date | null;
  createdAt: Date;
};

const MESSAGE_SELECT = {
  id: true,
  clientId: true,
  sender: true,
  kind: true,
  text: true,
  maskedText: true,
  imageUrls: true,
  refOrderId: true,
  refProductId: true,
  refQuoteRequestId: true,
  cardSnapshot: true,
  hiddenAt: true,
  createdAt: true,
} satisfies Prisma.ChatMessageSelect;

type CardSnapshot = {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  /** 고름 카드: 손님이 다른 가게를 골랐어요(가게에만) */
  otherChosen?: boolean;
};

/** 방의 쓰기 판단에 필요한 것(예약·입점 전 가게 대화 기간) */
type WriteContext = { hasActiveOrder: boolean; unenteredOpen: boolean };

/**
 * 채팅(기획 I-11) — 손님 × 가게 명부(입점 가게, 견적을 보낸 입점 전 가게).
 * 방은 손님이 첫 글을 보낼 때(또는 사장님이 픽업 전 예약 손님에게 처음 보낼 때) 생긴다.
 * 견적(I-46 ②): 입점 가게에 요청서 카드가 들어가면 방이 생기고(손님 목록에는 가게가 답한 뒤 보임),
 * 입점 전 가게는 견적을 보내면 방이 생겨 견적 링크 안에서 대화한다.
 * 가게 쓰기 규칙·차단·거르기·규칙 동의·도배 막기는 모두 여기서 서버가 판단한다.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: ChatNotifyService,
    private readonly opsAlert: OpsAlertService,
  ) {}

  // ───────────────────────── 공통 ─────────────────────────

  async agreeRules(actorType: "CONSUMER" | "SELLER", actorId: string, version: number) {
    if (version !== CHAT_RULES_VERSION) {
      throw new BadRequestException("채팅 이용 규칙이 바뀌었어요. 다시 확인해 주세요.");
    }
    await this.prisma.chatRuleAgreement.upsert({
      where: { actorType_actorId_version: { actorType, actorId, version } },
      create: { actorType, actorId, version },
      update: {},
    });
    return { agreed: true, version };
  }

  private async hasAgreed(actorType: "CONSUMER" | "SELLER", actorId: string): Promise<boolean> {
    const row = await this.prisma.chatRuleAgreement.findUnique({
      where: {
        actorType_actorId_version: { actorType, actorId, version: CHAT_RULES_VERSION },
      },
      select: { id: true },
    });
    return !!row;
  }

  private async ensureShopForStore(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, sellerId: true },
    });
    if (!store) throw new NotFoundException(CHAT_ERROR_MESSAGES.STORE_NOT_FOUND);
    const shop = await this.prisma.shop.upsert({
      where: { storeId },
      create: { storeId, name: store.name.slice(0, 100) },
      update: { name: store.name.slice(0, 100) },
      select: { id: true },
    });
    return { shopId: shop.id, store };
  }

  private async assertStoreOwner(sellerId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, sellerId: true },
    });
    if (!store) throw new NotFoundException(CHAT_ERROR_MESSAGES.STORE_NOT_FOUND);
    if (store.sellerId !== sellerId)
      throw new ForbiddenException(CHAT_ERROR_MESSAGES.STORE_NOT_OWNED);
  }

  private async hasActiveOrder(consumerId: string, storeId: string | null): Promise<boolean> {
    if (!storeId) return false;
    const count = await this.prisma.order.count({
      where: { consumerId, storeId, orderStatus: { in: CHAT_ACTIVE_ORDER_STATUSES } },
    });
    return count > 0;
  }

  /** 입점 전 가게 방: 이 손님 요청에 이 가게가 견적을 보냈고 대화 기간(고른 뒤 14일·마감 뒤 7일) 안인가 */
  private async unenteredOpen(thread: {
    consumerId: string;
    shopId: string;
    shop: { unentered: boolean; storeId: string | null };
  }): Promise<boolean> {
    if (!thread.shop.unentered || thread.shop.storeId) return false;
    const targets = await this.prisma.quoteRequestStore.findMany({
      where: {
        shopId: thread.shopId,
        quote: { isNot: null },
        quoteRequest: { consumerId: thread.consumerId },
      },
      select: {
        id: true,
        quoteRequest: {
          select: {
            status: true,
            deadlineAt: true,
            closedAt: true,
            chosenTargetId: true,
            chosenAt: true,
          },
        },
      },
    });
    const now = Date.now();
    return targets.some((t) => linkChatOpenUntil(t.quoteRequest, t.id).getTime() > now);
  }

  private async writeContext(side: Side, t: ThreadRow): Promise<WriteContext> {
    return {
      hasActiveOrder:
        side === "SHOP" ? await this.hasActiveOrder(t.consumerId, t.shop.storeId) : false,
      unenteredOpen: await this.unenteredOpen(t),
    };
  }

  private writeState(side: Side, thread: ThreadRow, ctx: WriteContext): ChatWriteStateDto {
    const unentered = thread.shop.unentered && !thread.shop.storeId;
    const shopHasStore = unentered ? ctx.unenteredOpen : !!thread.shop.storeId;
    const leftMessage = unentered
      ? CHAT_ERROR_MESSAGES.UNENTERED_CLOSED
      : CHAT_ERROR_MESSAGES.SHOP_LEFT;
    if (side === "CONSUMER") {
      const d = decideConsumerWrite({
        shopHasStore,
        blockedByConsumer: !!thread.blockedByConsumerAt,
        blockedByShop: !!thread.blockedByShopAt,
      });
      if (d.ok) return { ok: true, message: null };
      return {
        ok: false,
        message:
          d.reason === "SHOP_LEFT"
            ? leftMessage
            : thread.blockedByConsumerAt
              ? CHAT_ERROR_MESSAGES.BLOCKED_BY_ME
              : CHAT_ERROR_MESSAGES.CANNOT_SEND,
      };
    }
    const d = decideShopWrite({
      now: new Date(),
      shopHasStore,
      blockedByConsumer: !!thread.blockedByConsumerAt,
      blockedByShop: !!thread.blockedByShopAt,
      consumerWithdrawn: !!thread.consumer.withdrawnAt,
      lastConsumerMessageAt: thread.lastConsumerMessageAt,
      hasActiveOrder: ctx.hasActiveOrder,
      otherChosenAt: thread.shopLockedAt,
      // 견적을 보낸 입점 전 가게는 손님이 먼저 말하지 않아도 대화 기간 안에 쓸 수 있다
      liveQuote: unentered && ctx.unenteredOpen,
    });
    if (d.ok) return { ok: true, message: null };
    const message =
      d.reason === "LOCKED"
        ? CHAT_ERROR_MESSAGES.SHOP_LOCKED
        : d.reason === "OTHER_CHOSEN"
          ? CHAT_ERROR_MESSAGES.OTHER_CHOSEN
          : d.reason === "CONSUMER_GONE"
            ? "손님이 탈퇴해 대화가 지워졌어요."
            : d.reason === "SHOP_LEFT"
              ? leftMessage
              : d.reason === "BLOCKED" && thread.blockedByShopAt
                ? CHAT_ERROR_MESSAGES.BLOCKED_BY_ME
                : CHAT_ERROR_MESSAGES.CANNOT_SEND;
    return { ok: false, message };
  }

  /** 견적 카드 미리보기는 보는 쪽 말투로(서버에는 한 줄만 저장) */
  private previewFor(side: Side, preview: string | null): string | null {
    if (side === "CONSUMER") {
      if (preview === CHAT_QUOTE_PREVIEWS.REQUEST) return "견적 요청을 보냈어요";
      if (preview === CHAT_QUOTE_PREVIEWS.QUOTE) return "견적이 도착했어요";
      if (preview === CHAT_QUOTE_PREVIEWS.QUOTE_EDITED) return "견적이 바뀌었어요";
    } else if (preview === CHAT_QUOTE_PREVIEWS.CHOSEN) {
      return "손님이 견적을 골랐어요";
    }
    return preview;
  }

  private toThreadDto(side: Side, t: ThreadRow): ChatThreadDto {
    const title =
      side === "CONSUMER"
        ? (t.shop.store?.name ?? t.shop.name)
        : t.consumer.withdrawnAt
          ? "탈퇴한 손님"
          : t.consumer.nickname?.trim() || "손님";
    return {
      id: t.id,
      storeId: t.shop.storeId,
      title,
      imageUrl: side === "CONSUMER" ? (t.shop.store?.logoImageUrl ?? null) : null,
      lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: this.previewFor(side, t.lastMessagePreview),
      unread: isUnreadFor(side, t),
      needsReply: side === "SHOP" && t.lastMessageSender === "CONSUMER" && !t.shopLockedAt,
      muted: side === "CONSUMER" ? t.consumerMuted : t.shopMuted,
      blockedByMe: side === "CONSUMER" ? !!t.blockedByConsumerAt : !!t.blockedByShopAt,
      quoteRequest: side === "SHOP" && t.lastMessagePreview === CHAT_QUOTE_PREVIEWS.REQUEST,
    };
  }

  private async toDetailDto(
    side: Side,
    t: ThreadRow,
    actorId: string,
  ): Promise<ChatThreadDetailDto> {
    const otherReadAt = side === "CONSUMER" ? t.shopReadAt : t.consumerReadAt;
    const unentered = t.shop.unentered && !t.shop.storeId;
    return {
      ...this.toThreadDto(side, t),
      write: this.writeState(side, t, await this.writeContext(side, t)),
      otherReadAt: otherReadAt?.toISOString() ?? null,
      // 견적 링크 쪽(입점 전 가게)은 계정이 없어 규칙 동의를 링크 화면 안내로 대신한다
      rulesAgreed:
        unentered && side === "SHOP"
          ? true
          : await this.hasAgreed(side === "CONSUMER" ? "CONSUMER" : "SELLER", actorId),
      rulesVersion: CHAT_RULES_VERSION,
      unenteredShop: unentered,
    };
  }

  private async loadLiveCards(rows: MessageRow[], shopId: string) {
    const quoteRequestIds = [
      ...new Set(
        rows
          .filter((r) => r.kind === "QUOTE_REQUEST" || r.kind === "QUOTE")
          .map((r) => r.refQuoteRequestId)
          .filter((v): v is string => !!v),
      ),
    ];
    const quoteState = new Map<string, string>();
    if (quoteRequestIds.length) {
      const now = new Date();
      const requests = await this.prisma.quoteRequest.findMany({
        where: { id: { in: quoteRequestIds } },
        select: {
          id: true,
          status: true,
          deadlineAt: true,
          closedAt: true,
          chosenTargetId: true,
          chosenAt: true,
          _count: { select: { quotes: true } },
          stores: {
            where: { shopId },
            select: { id: true, declinedAt: true, quote: { select: { id: true } } },
          },
        },
      });
      for (const r of requests) {
        const target = r.stores[0];
        if (!target) continue;
        quoteState.set(
          r.id,
          targetState({
            request: r,
            targetId: target.id,
            declinedAt: target.declinedAt,
            hasQuote: !!target.quote,
            quoteCount: r._count.quotes,
            now,
          }),
        );
      }
    }
    const orderIds = [...new Set(rows.map((r) => r.refOrderId).filter((v): v is string => !!v))];
    const productIds = [
      ...new Set(rows.map((r) => r.refProductId).filter((v): v is string => !!v)),
    ];
    const [orders, products] = await Promise.all([
      orderIds.length
        ? this.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, orderStatus: true },
          })
        : [],
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, salesStatus: true, visibilityStatus: true },
          })
        : [],
    ]);
    return {
      quoteState,
      orderStatus: new Map(orders.map((o) => [o.id, o.orderStatus as string])),
      productAvailable: new Map(
        products.map((p) => [
          p.id,
          p.salesStatus === EnableStatus.ENABLE && p.visibilityStatus === EnableStatus.ENABLE,
        ]),
      ),
    };
  }

  private toMessageDto(
    viewer: Side,
    m: MessageRow,
    live: Awaited<ReturnType<ChatService["loadLiveCards"]>>,
  ): ChatMessageDto {
    const snap = (m.cardSnapshot ?? null) as CardSnapshot | null;
    let card: ChatMessageDto["card"] = null;
    if (m.kind === "ORDER" && m.refOrderId) {
      card = {
        type: "ORDER",
        refId: m.refOrderId,
        title: snap?.title ?? "주문",
        subtitle: snap?.subtitle ?? null,
        imageUrl: snap?.imageUrl ?? null,
        orderStatus: live.orderStatus.get(m.refOrderId) ?? null,
      };
    } else if (m.kind === "PRODUCT" && m.refProductId) {
      card = {
        type: "PRODUCT",
        refId: m.refProductId,
        title: snap?.title ?? "상품",
        subtitle: snap?.subtitle ?? null,
        imageUrl: snap?.imageUrl ?? null,
        available: live.productAvailable.get(m.refProductId) ?? false,
      };
    } else if (
      (m.kind === "QUOTE_REQUEST" || m.kind === "QUOTE" || m.kind === "QUOTE_CHOSEN") &&
      m.refQuoteRequestId
    ) {
      card = {
        type: m.kind,
        refId: m.refQuoteRequestId,
        title: snap?.title ?? "견적",
        subtitle: snap?.subtitle ?? null,
        imageUrl: snap?.imageUrl ?? null,
        quoteState: live.quoteState.get(m.refQuoteRequestId) ?? null,
        otherChosen: snap?.otherChosen ?? false,
      };
    }
    return {
      id: m.id,
      clientId: m.clientId,
      sender: m.sender,
      mine: m.sender === viewer,
      kind: m.kind,
      text: m.hiddenAt ? null : (m.maskedText ?? m.text),
      imageUrls: m.hiddenAt ? [] : m.imageUrls,
      card,
      hidden: !!m.hiddenAt,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private validateContent(dto: ChatSendDto): { text: string | null; imageUrls: string[] } {
    const text = dto.text?.trim() ? dto.text.trim() : null;
    const imageUrls = dto.imageUrls ?? [];
    if (!text && imageUrls.length === 0)
      throw new BadRequestException(CHAT_ERROR_MESSAGES.EMPTY_MESSAGE);
    if (text && text.length > CHAT_LIMITS.TEXT_MAX)
      throw new BadRequestException(CHAT_ERROR_MESSAGES.TEXT_TOO_LONG);
    if (imageUrls.length > CHAT_LIMITS.IMAGES_MAX)
      throw new BadRequestException(CHAT_ERROR_MESSAGES.TOO_MANY_IMAGES);
    if (imageUrls.some((u) => !isAllowedUploadUrl(u)))
      throw new BadRequestException(CHAT_ERROR_MESSAGES.INVALID_IMAGE);
    return { text, imageUrls };
  }

  private async assertSendRate(threadId: string, sender: Side) {
    const since = new Date(Date.now() - 60_000);
    const count = await this.prisma.chatMessage.count({
      where: { threadId, sender, createdAt: { gte: since } },
    });
    if (count >= CHAT_LIMITS.SEND_PER_MINUTE) {
      throw new HttpException(CHAT_ERROR_MESSAGES.TOO_FAST, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** clientId가 이미 있으면 그 글을 돌려준다(다시 보내기를 한 번만 저장) */
  private async insertMessage(
    threadId: string,
    data: Omit<Prisma.ChatMessageUncheckedCreateInput, "threadId">,
  ): Promise<{ row: MessageRow; created: boolean }> {
    const existing = await this.prisma.chatMessage.findUnique({
      where: { threadId_clientId: { threadId, clientId: data.clientId } },
      select: MESSAGE_SELECT,
    });
    if (existing) return { row: existing as MessageRow, created: false };
    try {
      const row = await this.prisma.chatMessage.create({
        data: { ...data, threadId },
        select: MESSAGE_SELECT,
      });
      return { row: row as MessageRow, created: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.chatMessage.findUniqueOrThrow({
          where: { threadId_clientId: { threadId, clientId: data.clientId } },
          select: MESSAGE_SELECT,
        });
        return { row: again as MessageRow, created: false };
      }
      throw e;
    }
  }

  private async afterSend(threadId: string, sender: Side, last: MessageRow) {
    const now = last.createdAt;
    const preview = buildPreview({
      text: last.text,
      maskedText: last.maskedText,
      imageCount: last.imageUrls.length,
      kind: last.kind,
    });
    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: now,
        lastMessageSender: sender,
        lastMessagePreview: preview.slice(0, 80),
        ...(sender === "CONSUMER"
          ? // 손님이 다시 말을 걸면 "다른 가게를 골랐어요" 잠금이 풀린다
            {
              lastConsumerMessageAt: now,
              consumerReadAt: now,
              consumerSeenAt: now,
              shopLockedAt: null,
            }
          : { shopReadAt: now, shopSeenAt: now }),
      },
    });
    // 견적 요청서만 있던 방도 누가 한 번 쓰면 손님 목록에 보인다
    await this.prisma.chatThread.updateMany({
      where: { id: threadId, consumerListedAt: null },
      data: { consumerListedAt: now },
    });
    await this.notify.afterMessage({ threadId, from: sender, preview });
  }

  /** 글(과 처음 붙는 카드)을 저장하고 알린다 */
  private async sendInto(
    thread: ThreadRow,
    sender: Side,
    senderSellerId: string | null,
    dto: ChatSendDto,
    card?: { kind: "ORDER" | "PRODUCT"; refId: string; snapshot: CardSnapshot },
  ): Promise<ChatSendResultDto> {
    const { text, imageUrls } = this.validateContent(dto);
    await this.assertSendRate(thread.id, sender);
    const saved: MessageRow[] = [];
    let anyCreated = false;

    if (card) {
      const already = await this.prisma.chatMessage.findFirst({
        where: {
          threadId: thread.id,
          kind: card.kind,
          ...(card.kind === "ORDER" ? { refOrderId: card.refId } : { refProductId: card.refId }),
        },
        select: { id: true },
      });
      if (!already) {
        const r = await this.insertMessage(thread.id, {
          clientId: `${dto.clientId}:card`.slice(0, 64),
          sender,
          senderSellerId,
          kind: card.kind,
          refOrderId: card.kind === "ORDER" ? card.refId : null,
          refProductId: card.kind === "PRODUCT" ? card.refId : null,
          cardSnapshot: card.snapshot as Prisma.InputJsonValue,
        });
        saved.push(r.row);
        anyCreated ||= r.created;
      }
    }

    const r = await this.insertMessage(thread.id, {
      clientId: dto.clientId,
      sender,
      senderSellerId,
      kind: imageUrls.length > 0 && !text ? "IMAGE" : "TEXT",
      text,
      maskedText: text ? maskBlockedWords(text) : null,
      imageUrls,
    });
    saved.push(r.row);
    anyCreated ||= r.created;

    if (anyCreated) await this.afterSend(thread.id, sender, r.row);
    const live = await this.loadLiveCards(saved, thread.shopId);
    return { threadId: thread.id, messages: saved.map((m) => this.toMessageDto(sender, m, live)) };
  }

  private async listMessages(
    side: Side,
    thread: ThreadRow,
    actorId: string,
    query: ChatMessagesQueryDto,
  ): Promise<ChatMessagesDto> {
    const take = CHAT_LIMITS.PAGE_SIZE;
    let rows: MessageRow[];
    let hasMore = false;
    if (query.after) {
      const pivot = await this.prisma.chatMessage.findFirst({
        where: { id: query.after, threadId: thread.id },
        select: { createdAt: true, id: true },
      });
      rows = (await this.prisma.chatMessage.findMany({
        where: {
          threadId: thread.id,
          AND: [{ OR: [{ onlyFor: null }, { onlyFor: side }] }],
          ...(pivot
            ? {
                OR: [
                  { createdAt: { gt: pivot.createdAt } },
                  { createdAt: pivot.createdAt, id: { gt: pivot.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 200,
        select: MESSAGE_SELECT,
      })) as MessageRow[];
    } else {
      const pivot = query.before
        ? await this.prisma.chatMessage.findFirst({
            where: { id: query.before, threadId: thread.id },
            select: { createdAt: true, id: true },
          })
        : null;
      const desc = (await this.prisma.chatMessage.findMany({
        where: {
          threadId: thread.id,
          AND: [{ OR: [{ onlyFor: null }, { onlyFor: side }] }],
          ...(pivot
            ? {
                OR: [
                  { createdAt: { lt: pivot.createdAt } },
                  { createdAt: pivot.createdAt, id: { lt: pivot.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: MESSAGE_SELECT,
      })) as MessageRow[];
      hasMore = desc.length > take;
      rows = desc.slice(0, take).reverse();
    }

    if (query.markRead) {
      const now = new Date();
      const seenAt = side === "CONSUMER" ? thread.consumerSeenAt : thread.shopSeenAt;
      const stale =
        !seenAt ||
        now.getTime() - seenAt.getTime() >= CHAT_LIMITS.SEEN_WRITE_INTERVAL_SECONDS * 1000;
      const unread = isUnreadFor(side, thread);
      if (stale || unread) {
        await this.prisma.chatThread.update({
          where: { id: thread.id },
          data:
            side === "CONSUMER"
              ? { consumerSeenAt: now, ...(unread ? { consumerReadAt: now } : {}) }
              : { shopSeenAt: now, ...(unread ? { shopReadAt: now } : {}) },
        });
        if (side === "CONSUMER") {
          thread.consumerSeenAt = now;
          if (unread) thread.consumerReadAt = now;
        } else {
          thread.shopSeenAt = now;
          if (unread) thread.shopReadAt = now;
        }
        if (unread) await this.notify.afterRead({ threadId: thread.id, reader: side });
      }
    }

    const live = await this.loadLiveCards(rows, thread.shopId);
    return {
      messages: rows.map((m) => this.toMessageDto(side, m, live)),
      hasMore,
      thread: await this.toDetailDto(side, thread, actorId),
    };
  }

  private async report(side: Side, reporterId: string, thread: ThreadRow, dto: ChatReportDto) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.prisma.chatReport.count({
      where: { reporter: side, reporterId, createdAt: { gte: since } },
    });
    if (count >= CHAT_LIMITS.REPORTS_PER_DAY) {
      throw new HttpException(CHAT_ERROR_MESSAGES.TOO_MANY_REPORTS, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (dto.messageId) {
      const msg = await this.prisma.chatMessage.findFirst({
        where: { id: dto.messageId, threadId: thread.id },
        select: { id: true },
      });
      if (!msg) throw new NotFoundException(CHAT_ERROR_MESSAGES.THREAD_NOT_FOUND);
    }
    const row = await this.prisma.chatReport.create({
      data: {
        threadId: thread.id,
        messageId: dto.messageId ?? null,
        reporter: side,
        reporterId,
        reason: dto.reason,
        detail: dto.detail?.trim() || null,
      },
      select: { id: true, reason: true, createdAt: true },
    });
    await this.opsAlert.notifyChatReport({
      id: row.id,
      reason: row.reason,
      reporter: side,
      createdAt: row.createdAt,
    });
    return { reportId: row.id, message: "신고를 받았어요. 24시간 안에 확인할게요." };
  }

  // ───────────────────────── 손님 ─────────────────────────

  private async getConsumerThread(consumerId: string, threadId: string): Promise<ThreadRow> {
    const t = await this.prisma.chatThread.findFirst({
      where: { id: threadId, consumerId },
      select: THREAD_SELECT,
    });
    if (!t) throw new NotFoundException(CHAT_ERROR_MESSAGES.THREAD_NOT_FOUND);
    return t;
  }

  async unreadForConsumer(consumerId: string): Promise<ChatUnreadDto> {
    const rows = await this.prisma.chatThread.findMany({
      where: { consumerId, lastMessageSender: "SHOP", consumerListedAt: { not: null } },
      select: {
        lastMessageAt: true,
        lastMessageSender: true,
        consumerReadAt: true,
        shopReadAt: true,
      },
    });
    return { unreadThreads: rows.filter((r) => isUnreadFor("CONSUMER", r)).length };
  }

  async listForConsumer(consumerId: string, query: ChatListQueryDto): Promise<ChatThreadListDto> {
    const cursor = query.cursor ? new Date(query.cursor) : null;
    const rows = await this.prisma.chatThread.findMany({
      where: {
        consumerId,
        consumerListedAt: { not: null },
        lastMessageAt: cursor && !Number.isNaN(cursor.getTime()) ? { lt: cursor } : { not: null },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: CHAT_LIMITS.PAGE_SIZE + 1,
      select: THREAD_SELECT,
    });
    const page = rows.slice(0, CHAT_LIMITS.PAGE_SIZE);
    return {
      threads: page.map((t) => this.toThreadDto("CONSUMER", t)),
      nextCursor:
        rows.length > CHAT_LIMITS.PAGE_SIZE
          ? (page[page.length - 1].lastMessageAt?.toISOString() ?? null)
          : null,
    };
  }

  async existingForConsumer(consumerId: string, storeId: string): Promise<ChatExistingThreadDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, shop: { select: { id: true } } },
    });
    if (!store) throw new NotFoundException(CHAT_ERROR_MESSAGES.STORE_NOT_FOUND);
    const thread = store.shop
      ? await this.prisma.chatThread.findUnique({
          where: { consumerId_shopId: { consumerId, shopId: store.shop.id } },
          select: THREAD_SELECT,
        })
      : null;
    return {
      threadId: thread?.id ?? null,
      title: store.name,
      write: thread
        ? this.writeState("CONSUMER", thread, await this.writeContext("CONSUMER", thread))
        : { ok: true, message: null },
      rulesAgreed: await this.hasAgreed("CONSUMER", consumerId),
      rulesVersion: CHAT_RULES_VERSION,
    };
  }

  async threadForConsumer(consumerId: string, threadId: string): Promise<ChatThreadDetailDto> {
    const t = await this.getConsumerThread(consumerId, threadId);
    return this.toDetailDto("CONSUMER", t, consumerId);
  }

  async messagesForConsumer(consumerId: string, threadId: string, query: ChatMessagesQueryDto) {
    const t = await this.getConsumerThread(consumerId, threadId);
    return this.listMessages("CONSUMER", t, consumerId, query);
  }

  /** 가게에 처음 보내기 — 방이 없으면 여기서 생긴다 */
  async startForConsumer(
    consumerId: string,
    dto: ConsumerStartChatDto,
  ): Promise<ChatSendResultDto> {
    if (!(await this.hasAgreed("CONSUMER", consumerId))) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.RULES_NOT_AGREED);
    }
    this.validateContent(dto);
    const { shopId } = await this.ensureShopForStore(dto.storeId);

    let card: { kind: "ORDER" | "PRODUCT"; refId: string; snapshot: CardSnapshot } | undefined;
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, consumerId, storeId: dto.storeId },
        select: {
          id: true,
          orderNumber: true,
          productName: true,
          productImages: true,
          pickupDate: true,
        },
      });
      if (!order) throw new NotFoundException(CHAT_ERROR_MESSAGES.ORDER_NOT_FOUND);
      card = { kind: "ORDER", refId: order.id, snapshot: this.orderSnapshot(order) };
    } else if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, storeId: dto.storeId },
        select: { id: true, name: true, images: true, salePrice: true },
      });
      if (!product) throw new NotFoundException(CHAT_ERROR_MESSAGES.PRODUCT_NOT_FOUND);
      card = {
        kind: "PRODUCT",
        refId: product.id,
        snapshot: {
          title: product.name,
          subtitle: `${product.salePrice.toLocaleString()}원`,
          imageUrl: product.images[0] ?? null,
        },
      };
    }

    let thread = await this.prisma.chatThread.findUnique({
      where: { consumerId_shopId: { consumerId, shopId } },
      select: THREAD_SELECT,
    });
    if (!thread) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const opened = await this.prisma.chatThread.count({
        where: { consumerId, createdAt: { gte: since } },
      });
      if (opened >= CHAT_LIMITS.NEW_THREADS_PER_DAY) {
        throw new HttpException(CHAT_ERROR_MESSAGES.TOO_MANY_THREADS, HttpStatus.TOO_MANY_REQUESTS);
      }
      thread = await this.createThread(consumerId, shopId);
    }
    const w = this.writeState("CONSUMER", thread, await this.writeContext("CONSUMER", thread));
    if (!w.ok) throw new ForbiddenException(w.message ?? CHAT_ERROR_MESSAGES.CANNOT_SEND);
    return this.sendInto(thread, "CONSUMER", null, dto, card);
  }

  async sendForConsumer(consumerId: string, threadId: string, dto: ChatSendDto) {
    if (!(await this.hasAgreed("CONSUMER", consumerId))) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.RULES_NOT_AGREED);
    }
    const t = await this.getConsumerThread(consumerId, threadId);
    const w = this.writeState("CONSUMER", t, await this.writeContext("CONSUMER", t));
    if (!w.ok) throw new ForbiddenException(w.message ?? CHAT_ERROR_MESSAGES.CANNOT_SEND);
    return this.sendInto(t, "CONSUMER", null, dto);
  }

  async setConsumerFlag(
    consumerId: string,
    threadId: string,
    flag: "mute" | "block",
    value: boolean,
  ) {
    await this.getConsumerThread(consumerId, threadId);
    await this.prisma.chatThread.update({
      where: { id: threadId },
      data:
        flag === "mute"
          ? { consumerMuted: value }
          : { blockedByConsumerAt: value ? new Date() : null },
    });
    return this.threadForConsumer(consumerId, threadId);
  }

  async reportForConsumer(consumerId: string, threadId: string, dto: ChatReportDto) {
    const t = await this.getConsumerThread(consumerId, threadId);
    return this.report("CONSUMER", consumerId, t, dto);
  }

  // ───────────────────────── 사장님 ─────────────────────────

  private async getStoreThread(storeId: string, threadId: string): Promise<ThreadRow> {
    const t = await this.prisma.chatThread.findFirst({
      where: { id: threadId, shop: { storeId } },
      select: THREAD_SELECT,
    });
    if (!t) throw new NotFoundException(CHAT_ERROR_MESSAGES.THREAD_NOT_FOUND);
    return t;
  }

  /**
   * "답할 것": 마지막 글이 손님 것이고 사장님이 지금 답할 수 있는 방(차단·탈퇴 아님, 손님 마지막 글 30일 안).
   * 답할 수 없는 방이 숫자에 남아 줄지 않는 일을 막는다. 30일 지나도 픽업 전 예약으로 답할 수 있는 방은 "전체"에 있다
   */
  private replyNeededWhere(now: Date): Prisma.ChatThreadWhereInput {
    return {
      lastMessageSender: "CONSUMER",
      shopLockedAt: null,
      blockedByShopAt: null,
      blockedByConsumerAt: null,
      consumer: { withdrawnAt: null },
      lastConsumerMessageAt: {
        gte: new Date(now.getTime() - CHAT_LIMITS.SHOP_WRITE_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      },
    };
  }

  async unreadForStore(sellerId: string, storeId: string): Promise<ChatUnreadDto> {
    await this.assertStoreOwner(sellerId, storeId);
    const rows = await this.prisma.chatThread.findMany({
      where: { shop: { storeId }, lastMessageSender: "CONSUMER" },
      select: {
        lastMessageAt: true,
        lastMessageSender: true,
        consumerReadAt: true,
        shopReadAt: true,
      },
    });
    const replyNeeded = await this.prisma.chatThread.count({
      where: { shop: { storeId }, ...this.replyNeededWhere(new Date()) },
    });
    return {
      unreadThreads: rows.filter((r) => isUnreadFor("SHOP", r)).length,
      replyNeeded,
    };
  }

  async listForStore(
    sellerId: string,
    storeId: string,
    query: ChatListQueryDto,
  ): Promise<ChatThreadListDto> {
    await this.assertStoreOwner(sellerId, storeId);
    const cursor = query.cursor ? new Date(query.cursor) : null;
    const rows = await this.prisma.chatThread.findMany({
      where: {
        shop: { storeId },
        lastMessageAt: cursor && !Number.isNaN(cursor.getTime()) ? { lt: cursor } : { not: null },
        ...(query.filter === "reply" ? this.replyNeededWhere(new Date()) : {}),
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: CHAT_LIMITS.PAGE_SIZE + 1,
      select: THREAD_SELECT,
    });
    const page = rows.slice(0, CHAT_LIMITS.PAGE_SIZE);
    return {
      threads: page.map((t) => this.toThreadDto("SHOP", t)),
      nextCursor:
        rows.length > CHAT_LIMITS.PAGE_SIZE
          ? (page[page.length - 1].lastMessageAt?.toISOString() ?? null)
          : null,
    };
  }

  async threadForStore(sellerId: string, storeId: string, threadId: string) {
    await this.assertStoreOwner(sellerId, storeId);
    const t = await this.getStoreThread(storeId, threadId);
    return this.toDetailDto("SHOP", t, sellerId);
  }

  async messagesForStore(
    sellerId: string,
    storeId: string,
    threadId: string,
    query: ChatMessagesQueryDto,
  ) {
    await this.assertStoreOwner(sellerId, storeId);
    const t = await this.getStoreThread(storeId, threadId);
    return this.listMessages("SHOP", t, sellerId, query);
  }

  async sendForStore(sellerId: string, storeId: string, threadId: string, dto: ChatSendDto) {
    await this.assertStoreOwner(sellerId, storeId);
    if (!(await this.hasAgreed("SELLER", sellerId))) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.RULES_NOT_AGREED);
    }
    const t = await this.getStoreThread(storeId, threadId);
    const w = this.writeState("SHOP", t, await this.writeContext("SHOP", t));
    if (!w.ok) throw new ForbiddenException(w.message ?? CHAT_ERROR_MESSAGES.CANNOT_SEND);
    return this.sendInto(t, "SHOP", sellerId, dto);
  }

  /** 주문 상세 "채팅": 이 주문 손님과의 방(있으면)과 먼저 쓸 수 있는지 */
  async byOrderForStore(
    sellerId: string,
    storeId: string,
    orderId: string,
  ): Promise<ChatExistingThreadDto> {
    await this.assertStoreOwner(sellerId, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      select: {
        consumerId: true,
        orderStatus: true,
        consumer: { select: { nickname: true, withdrawnAt: true } },
      },
    });
    if (!order) throw new NotFoundException(CHAT_ERROR_MESSAGES.ORDER_NOT_FOUND);
    const shop = await this.prisma.shop.findUnique({ where: { storeId }, select: { id: true } });
    const thread = shop
      ? await this.prisma.chatThread.findUnique({
          where: { consumerId_shopId: { consumerId: order.consumerId, shopId: shop.id } },
          select: THREAD_SELECT,
        })
      : null;
    const active = CHAT_ACTIVE_ORDER_STATUSES.includes(order.orderStatus as OrderStatus);
    const write: ChatWriteStateDto = thread
      ? this.writeState("SHOP", thread, await this.writeContext("SHOP", thread))
      : order.consumer.withdrawnAt
        ? { ok: false, message: "손님이 탈퇴해 대화가 지워졌어요." }
        : active
          ? { ok: true, message: null }
          : { ok: false, message: CHAT_ERROR_MESSAGES.ORDER_NOT_ACTIVE };
    return {
      threadId: thread?.id ?? null,
      title: order.consumer.withdrawnAt ? "탈퇴한 손님" : order.consumer.nickname?.trim() || "손님",
      write,
      rulesAgreed: await this.hasAgreed("SELLER", sellerId),
      rulesVersion: CHAT_RULES_VERSION,
    };
  }

  /** 사장님이 픽업 전 예약 손님에게 먼저 보내기(운영자 결정 11-11). 주문 카드가 먼저 붙는다 */
  async startFromOrderForStore(
    sellerId: string,
    storeId: string,
    orderId: string,
    dto: ChatSendDto,
  ) {
    await this.assertStoreOwner(sellerId, storeId);
    if (!(await this.hasAgreed("SELLER", sellerId))) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.RULES_NOT_AGREED);
    }
    this.validateContent(dto);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      select: {
        id: true,
        consumerId: true,
        orderStatus: true,
        orderNumber: true,
        productName: true,
        productImages: true,
        pickupDate: true,
      },
    });
    if (!order) throw new NotFoundException(CHAT_ERROR_MESSAGES.ORDER_NOT_FOUND);
    const { shopId } = await this.ensureShopForStore(storeId);
    let thread = await this.prisma.chatThread.findUnique({
      where: { consumerId_shopId: { consumerId: order.consumerId, shopId } },
      select: THREAD_SELECT,
    });
    const active = CHAT_ACTIVE_ORDER_STATUSES.includes(order.orderStatus as OrderStatus);
    if (!thread) {
      if (!active) throw new ForbiddenException(CHAT_ERROR_MESSAGES.ORDER_NOT_ACTIVE);
      thread = await this.createThread(order.consumerId, shopId);
    }
    const w = this.writeState("SHOP", thread, await this.writeContext("SHOP", thread));
    if (!w.ok) throw new ForbiddenException(w.message ?? CHAT_ERROR_MESSAGES.CANNOT_SEND);
    return this.sendInto(thread, "SHOP", sellerId, dto, {
      kind: "ORDER",
      refId: order.id,
      snapshot: this.orderSnapshot(order),
    });
  }

  async setStoreFlag(
    sellerId: string,
    storeId: string,
    threadId: string,
    flag: "mute" | "block",
    value: boolean,
  ) {
    await this.assertStoreOwner(sellerId, storeId);
    await this.getStoreThread(storeId, threadId);
    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: flag === "mute" ? { shopMuted: value } : { blockedByShopAt: value ? new Date() : null },
    });
    return this.threadForStore(sellerId, storeId, threadId);
  }

  async reportForStore(sellerId: string, storeId: string, threadId: string, dto: ChatReportDto) {
    await this.assertStoreOwner(sellerId, storeId);
    const t = await this.getStoreThread(storeId, threadId);
    return this.report("SHOP", sellerId, t, dto);
  }

  // ───────────────────────── 견적(I-46 ②) ─────────────────────────

  /** 입점 가게의 가게 명부 줄 */
  async shopIdForStore(storeId: string): Promise<string> {
    return (await this.ensureShopForStore(storeId)).shopId;
  }

  /** 입점 전 가게(카카오 장소, 또는 운영자가 넣은 가게)의 가게 명부 줄 */
  async shopIdForUnentered(input: { kakaoPlaceId: string | null; name: string }): Promise<string> {
    const name = input.name.slice(0, 100);
    if (input.kakaoPlaceId) {
      const shop = await this.prisma.shop.upsert({
        where: { kakaoPlaceId: input.kakaoPlaceId },
        create: { kakaoPlaceId: input.kakaoPlaceId, name, unentered: true },
        update: {},
        select: { id: true },
      });
      return shop.id;
    }
    const shop = await this.prisma.shop.create({
      data: { name, unentered: true },
      select: { id: true },
    });
    return shop.id;
  }

  private async findOrCreateThreadFor(
    consumerId: string,
    shopId: string,
    listed: boolean,
  ): Promise<ThreadRow> {
    const existing = await this.prisma.chatThread.findUnique({
      where: { consumerId_shopId: { consumerId, shopId } },
      select: THREAD_SELECT,
    });
    if (existing) return existing;
    try {
      return await this.prisma.chatThread.create({
        data: { consumerId, shopId, consumerListedAt: listed ? new Date() : null },
        select: THREAD_SELECT,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return this.prisma.chatThread.findUniqueOrThrow({
          where: { consumerId_shopId: { consumerId, shopId } },
          select: THREAD_SELECT,
        });
      }
      throw e;
    }
  }

  /**
   * 입점 가게 채팅방에 손님 요청서 카드를 넣는다(판매자 앱에서 받기, 운영자 결정 2026-11-12 A안).
   * 사장님 "답할 것"에 들어가고 휴대폰 알림이 간다. 손님 목록에는 가게가 답하기 전까지 보이지 않는다.
   * 같은 요청은 한 번만 들어간다. @returns 방 ID
   */
  async postQuoteRequestCard(input: {
    consumerId: string;
    shopId: string;
    requestId: string;
    snapshot: CardSnapshot;
  }): Promise<string> {
    const thread = await this.findOrCreateThreadFor(input.consumerId, input.shopId, false);
    const { row, created } = await this.insertMessage(thread.id, {
      clientId: `quote-request:${input.requestId}`.slice(0, 64),
      sender: "CONSUMER",
      senderSellerId: null,
      kind: "QUOTE_REQUEST",
      refQuoteRequestId: input.requestId,
      cardSnapshot: input.snapshot as Prisma.InputJsonValue,
    });
    if (created) {
      const now = row.createdAt;
      await this.prisma.chatThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: now,
          lastMessageSender: "CONSUMER",
          lastMessagePreview: CHAT_QUOTE_PREVIEWS.REQUEST,
          lastConsumerMessageAt: now,
          consumerReadAt: now,
          shopLockedAt: null,
        },
      });
      await this.notify.afterQuoteEvent({
        threadId: thread.id,
        seller: {
          title: SELLER_QUOTE_PUSH_TITLES.REQUEST,
          body: input.snapshot.subtitle ?? input.snapshot.title,
        },
      });
    }
    return thread.id;
  }

  /**
   * 가게 견적 카드(도착·고침). 손님 목록에 방이 보이기 시작한다.
   * 채팅 알림·안 읽은 수는 만들지 않는다(견적 알림이 따로 가고 "내 견적"에 숫자가 생김, 기획 I-11 "한 일에 알림은 한 번만").
   */
  async postQuoteCard(input: {
    consumerId: string;
    shopId: string;
    requestId: string;
    quoteId: string;
    version: number;
    edited: boolean;
    senderSellerId: string | null;
    snapshot: CardSnapshot;
  }): Promise<string> {
    const thread = await this.findOrCreateThreadFor(input.consumerId, input.shopId, true);
    const unreadBefore = isUnreadFor("CONSUMER", thread);
    const { row, created } = await this.insertMessage(thread.id, {
      clientId: `quote:${input.quoteId}:${input.version}`.slice(0, 64),
      sender: "SHOP",
      senderSellerId: input.senderSellerId,
      kind: "QUOTE",
      refQuoteRequestId: input.requestId,
      cardSnapshot: input.snapshot as Prisma.InputJsonValue,
    });
    if (created) {
      const now = row.createdAt;
      await this.prisma.chatThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: now,
          lastMessageSender: "SHOP",
          lastMessagePreview: input.edited
            ? CHAT_QUOTE_PREVIEWS.QUOTE_EDITED
            : CHAT_QUOTE_PREVIEWS.QUOTE,
          shopReadAt: now,
          shopSeenAt: now,
          consumerListedAt: thread.consumerListedAt ?? now,
          ...(unreadBefore ? {} : { consumerReadAt: now }),
        },
      });
      await this.notify.afterQuoteEvent({ threadId: thread.id });
    }
    return thread.id;
  }

  /**
   * 손님이 견적을 고름. 고른 가게 방에 "이 견적을 골랐어요"(가게 답할 것, 입점 가게는 휴대폰 알림),
   * 다른 가게 방에는 가게에만 보이는 "손님이 다른 가게 견적을 골랐어요"와 쓰기 잠금(손님이 다시 말하면 풀림).
   * @returns 고른 가게와의 방 ID
   */
  async postChosenCards(input: {
    consumerId: string;
    requestId: string;
    chosenShopId: string;
    otherShopIds: string[];
    snapshot: CardSnapshot;
  }): Promise<string> {
    const stamp = Date.now();
    const thread = await this.findOrCreateThreadFor(input.consumerId, input.chosenShopId, true);
    const { row } = await this.insertMessage(thread.id, {
      clientId: `quote-chosen:${input.requestId}:${stamp}`.slice(0, 64),
      sender: "CONSUMER",
      senderSellerId: null,
      kind: "QUOTE_CHOSEN",
      refQuoteRequestId: input.requestId,
      cardSnapshot: input.snapshot as Prisma.InputJsonValue,
    });
    const now = row.createdAt;
    await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt: now,
        lastMessageSender: "CONSUMER",
        lastMessagePreview: CHAT_QUOTE_PREVIEWS.CHOSEN,
        lastConsumerMessageAt: now,
        consumerReadAt: now,
        consumerSeenAt: now,
        consumerListedAt: thread.consumerListedAt ?? now,
        shopLockedAt: null,
      },
    });
    await this.notify.afterQuoteEvent({
      threadId: thread.id,
      seller: {
        title: SELLER_QUOTE_PUSH_TITLES.CHOSEN,
        body: input.snapshot.subtitle ?? input.snapshot.title,
      },
    });

    for (const shopId of input.otherShopIds) {
      if (shopId === input.chosenShopId) continue;
      const other = await this.prisma.chatThread.findUnique({
        where: { consumerId_shopId: { consumerId: input.consumerId, shopId } },
        select: { id: true },
      });
      if (!other) continue;
      await this.insertMessage(other.id, {
        clientId: `quote-other:${input.requestId}:${stamp}`.slice(0, 64),
        sender: "SYSTEM",
        senderSellerId: null,
        kind: "QUOTE_CHOSEN",
        refQuoteRequestId: input.requestId,
        onlyFor: "SHOP",
        cardSnapshot: {
          title: "손님이 다른 가게 견적을 골랐어요",
          subtitle: "손님이 다시 말을 걸면 대화를 이어 갈 수 있어요",
          otherChosen: true,
        } as Prisma.InputJsonValue,
      });
      await this.prisma.chatThread.update({
        where: { id: other.id },
        data: { shopLockedAt: new Date() },
      });
      await this.notify.afterQuoteEvent({ threadId: other.id });
    }
    return thread.id;
  }

  /**
   * 견적 요청이 마감·닫힘·다른 가게 고름으로 끝나면, 요청서 카드만 있고 사장님이 아직 답하지 않은 방을
   * "답할 것"·안 읽음에서 뺀다(30일 동안 답할 것으로 남지 않게). 방과 카드는 그대로 두고 카드에 "마감"이 보인다.
   * @returns 바꾼 방 수
   */
  async retireQuoteRequestCards(requestId: string): Promise<number> {
    const threads = await this.prisma.chatThread.findMany({
      where: {
        lastMessageSender: "CONSUMER",
        lastMessagePreview: CHAT_QUOTE_PREVIEWS.REQUEST,
        messages: { some: { kind: "QUOTE_REQUEST", refQuoteRequestId: requestId } },
      },
      select: { id: true, lastMessageAt: true },
    });
    for (const t of threads) {
      await this.prisma.chatThread.update({
        where: { id: t.id },
        data: { lastMessageSender: "SYSTEM", shopReadAt: t.lastMessageAt ?? new Date() },
      });
      await this.notify.afterQuoteEvent({ threadId: t.id });
    }
    return threads.length;
  }

  /** 이 손님 × 가게 방(없으면 null) */
  async threadIdFor(consumerId: string, shopId: string): Promise<string | null> {
    const t = await this.prisma.chatThread.findUnique({
      where: { consumerId_shopId: { consumerId, shopId } },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  /** 견적 링크(입점 전 가게) 쪽에서 대화 읽기. 방이 없으면 null */
  async messagesForLink(
    pair: { consumerId: string; shopId: string },
    query: ChatMessagesQueryDto,
  ): Promise<ChatMessagesDto | null> {
    const t = await this.prisma.chatThread.findUnique({
      where: { consumerId_shopId: pair },
      select: THREAD_SELECT,
    });
    if (!t) return null;
    return this.listMessages("SHOP", t, "link", query);
  }

  /** 견적 링크(입점 전 가게) 쪽에서 보내기. 견적을 보내 방이 생긴 뒤에만 */
  async sendForLink(
    pair: { consumerId: string; shopId: string },
    dto: ChatSendDto,
  ): Promise<ChatSendResultDto> {
    const t = await this.prisma.chatThread.findUnique({
      where: { consumerId_shopId: pair },
      select: THREAD_SELECT,
    });
    if (!t || !t.shop.unentered) throw new NotFoundException(CHAT_ERROR_MESSAGES.THREAD_NOT_FOUND);
    const w = this.writeState("SHOP", t, await this.writeContext("SHOP", t));
    if (!w.ok) throw new ForbiddenException(w.message ?? CHAT_ERROR_MESSAGES.CANNOT_SEND);
    return this.sendInto(t, "SHOP", null, dto);
  }

  // ───────────────────────── 내부 ─────────────────────────

  private orderSnapshot(order: {
    orderNumber: string;
    productName: string | null;
    productImages: string[];
    pickupDate: Date | null;
  }): CardSnapshot {
    const pickup = order.pickupDate ? `${formatKstDate(order.pickupDate)} 픽업` : null;
    return {
      title: order.productName ?? "주문",
      subtitle: [`주문 ${order.orderNumber}`, pickup].filter(Boolean).join(" · "),
      imageUrl: order.productImages[0] ?? null,
    };
  }

  private async createThread(consumerId: string, shopId: string): Promise<ThreadRow> {
    try {
      return await this.prisma.chatThread.create({
        data: { consumerId, shopId },
        select: THREAD_SELECT,
      });
    } catch (e) {
      // 두 쪽이 동시에 첫 글을 보내면 한 쌍에 방이 하나만 생기게(유일 제약) — 이미 생긴 방을 쓴다
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return this.prisma.chatThread.findUniqueOrThrow({
          where: { consumerId_shopId: { consumerId, shopId } },
          select: THREAD_SELECT,
        });
      }
      throw e;
    }
  }
}
