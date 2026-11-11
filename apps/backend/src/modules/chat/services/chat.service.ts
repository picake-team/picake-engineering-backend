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
  CHAT_RULES_VERSION,
} from "@apps/backend/modules/chat/constants/chat.constants";
import {
  ChatListQueryDto,
  ChatMessageDto,
  ChatMessagesDto,
  ChatMessagesQueryDto,
  ChatReportDto,
  ChatSendDto,
  ChatSendResultDto,
  ChatStatusDto,
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
import { ChatOpenService } from "@apps/backend/modules/chat/services/chat-open.service";
import { ChatNotifyService } from "@apps/backend/modules/chat/services/chat-notify.service";
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
  consumer: { select: { nickname: true, withdrawnAt: true } },
  shop: {
    select: {
      id: true,
      name: true,
      storeId: true,
      store: { select: { id: true, name: true, logoImageUrl: true, sellerId: true } },
    },
  },
} satisfies Prisma.ChatThreadSelect;

type ThreadRow = Prisma.ChatThreadGetPayload<{ select: typeof THREAD_SELECT }>;

type MessageRow = {
  id: string;
  clientId: string;
  sender: "CONSUMER" | "SHOP" | "SYSTEM";
  kind: "TEXT" | "IMAGE" | "ORDER" | "PRODUCT";
  text: string | null;
  maskedText: string | null;
  imageUrls: string[];
  refOrderId: string | null;
  refProductId: string | null;
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
  cardSnapshot: true,
  hiddenAt: true,
  createdAt: true,
} satisfies Prisma.ChatMessageSelect;

type CardSnapshot = { title: string; subtitle?: string | null; imageUrl?: string | null };

/**
 * 채팅(기획 I-11) 1단계 — 손님 × 입점 가게.
 * 방은 손님이 첫 글을 보낼 때(또는 사장님이 픽업 전 예약 손님에게 처음 보낼 때) 생긴다.
 * 가게 쓰기 규칙·차단·거르기·규칙 동의·도배 막기는 모두 여기서 서버가 판단한다.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly open: ChatOpenService,
    private readonly notify: ChatNotifyService,
    private readonly opsAlert: OpsAlertService,
  ) {}

  // ───────────────────────── 공통 ─────────────────────────

  async status(): Promise<ChatStatusDto> {
    return { open: await this.open.isOpen(), rulesVersion: CHAT_RULES_VERSION };
  }

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

  private writeState(side: Side, thread: ThreadRow, hasActiveOrder: boolean): ChatWriteStateDto {
    const shopHasStore = !!thread.shop.storeId;
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
            ? CHAT_ERROR_MESSAGES.SHOP_LEFT
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
      hasActiveOrder,
    });
    if (d.ok) return { ok: true, message: null };
    const message =
      d.reason === "LOCKED"
        ? CHAT_ERROR_MESSAGES.SHOP_LOCKED
        : d.reason === "CONSUMER_GONE"
          ? "손님이 탈퇴해 대화가 지워졌어요."
          : d.reason === "SHOP_LEFT"
            ? CHAT_ERROR_MESSAGES.SHOP_LEFT
            : CHAT_ERROR_MESSAGES.CANNOT_SEND;
    return { ok: false, message };
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
      lastMessagePreview: t.lastMessagePreview,
      unread: isUnreadFor(side, t),
      needsReply: side === "SHOP" && t.lastMessageSender === "CONSUMER",
      muted: side === "CONSUMER" ? t.consumerMuted : t.shopMuted,
      blockedByMe: side === "CONSUMER" ? !!t.blockedByConsumerAt : !!t.blockedByShopAt,
    };
  }

  private async toDetailDto(
    side: Side,
    t: ThreadRow,
    actorId: string,
  ): Promise<ChatThreadDetailDto> {
    const active =
      side === "SHOP" ? await this.hasActiveOrder(t.consumerId, t.shop.storeId) : false;
    const otherReadAt = side === "CONSUMER" ? t.shopReadAt : t.consumerReadAt;
    return {
      ...this.toThreadDto(side, t),
      write: this.writeState(side, t, active),
      otherReadAt: otherReadAt?.toISOString() ?? null,
      rulesAgreed: await this.hasAgreed(side === "CONSUMER" ? "CONSUMER" : "SELLER", actorId),
      rulesVersion: CHAT_RULES_VERSION,
      unenteredShop: false,
    };
  }

  private async loadLiveCards(rows: MessageRow[]) {
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
          ? { lastConsumerMessageAt: now, consumerReadAt: now, consumerSeenAt: now }
          : { shopReadAt: now, shopSeenAt: now }),
      },
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
    const live = await this.loadLiveCards(saved);
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
      }
    }

    const live = await this.loadLiveCards(rows);
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
    if (!(await this.open.isOpen())) return { open: false, unreadThreads: 0 };
    const rows = await this.prisma.chatThread.findMany({
      where: { consumerId, lastMessageSender: "SHOP" },
      select: {
        lastMessageAt: true,
        lastMessageSender: true,
        consumerReadAt: true,
        shopReadAt: true,
      },
    });
    return { open: true, unreadThreads: rows.filter((r) => isUnreadFor("CONSUMER", r)).length };
  }

  async listForConsumer(consumerId: string, query: ChatListQueryDto): Promise<ChatThreadListDto> {
    await this.open.assertOpen();
    const cursor = query.cursor ? new Date(query.cursor) : null;
    const rows = await this.prisma.chatThread.findMany({
      where: {
        consumerId,
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
    await this.open.assertOpen();
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
      write: thread ? this.writeState("CONSUMER", thread, false) : { ok: true, message: null },
      rulesAgreed: await this.hasAgreed("CONSUMER", consumerId),
      rulesVersion: CHAT_RULES_VERSION,
    };
  }

  async threadForConsumer(consumerId: string, threadId: string): Promise<ChatThreadDetailDto> {
    await this.open.assertOpen();
    const t = await this.getConsumerThread(consumerId, threadId);
    return this.toDetailDto("CONSUMER", t, consumerId);
  }

  async messagesForConsumer(consumerId: string, threadId: string, query: ChatMessagesQueryDto) {
    await this.open.assertOpen();
    const t = await this.getConsumerThread(consumerId, threadId);
    return this.listMessages("CONSUMER", t, consumerId, query);
  }

  /** 가게에 처음 보내기 — 방이 없으면 여기서 생긴다 */
  async startForConsumer(
    consumerId: string,
    dto: ConsumerStartChatDto,
  ): Promise<ChatSendResultDto> {
    await this.open.assertOpen();
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
    const w = this.writeState("CONSUMER", thread, false);
    if (!w.ok) throw new ForbiddenException(w.message ?? CHAT_ERROR_MESSAGES.CANNOT_SEND);
    return this.sendInto(thread, "CONSUMER", null, dto, card);
  }

  async sendForConsumer(consumerId: string, threadId: string, dto: ChatSendDto) {
    await this.open.assertOpen();
    if (!(await this.hasAgreed("CONSUMER", consumerId))) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.RULES_NOT_AGREED);
    }
    const t = await this.getConsumerThread(consumerId, threadId);
    const w = this.writeState("CONSUMER", t, false);
    if (!w.ok) throw new ForbiddenException(w.message ?? CHAT_ERROR_MESSAGES.CANNOT_SEND);
    return this.sendInto(t, "CONSUMER", null, dto);
  }

  async setConsumerFlag(
    consumerId: string,
    threadId: string,
    flag: "mute" | "block",
    value: boolean,
  ) {
    await this.open.assertOpen();
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
    await this.open.assertOpen();
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

  async unreadForStore(sellerId: string, storeId: string): Promise<ChatUnreadDto> {
    await this.assertStoreOwner(sellerId, storeId);
    if (!(await this.open.isOpen())) return { open: false, unreadThreads: 0, replyNeeded: 0 };
    const rows = await this.prisma.chatThread.findMany({
      where: { shop: { storeId }, lastMessageSender: "CONSUMER" },
      select: {
        lastMessageAt: true,
        lastMessageSender: true,
        consumerReadAt: true,
        shopReadAt: true,
      },
    });
    return {
      open: true,
      unreadThreads: rows.filter((r) => isUnreadFor("SHOP", r)).length,
      replyNeeded: rows.length,
    };
  }

  async listForStore(
    sellerId: string,
    storeId: string,
    query: ChatListQueryDto,
  ): Promise<ChatThreadListDto> {
    await this.assertStoreOwner(sellerId, storeId);
    await this.open.assertOpen();
    const cursor = query.cursor ? new Date(query.cursor) : null;
    const rows = await this.prisma.chatThread.findMany({
      where: {
        shop: { storeId },
        lastMessageAt: cursor && !Number.isNaN(cursor.getTime()) ? { lt: cursor } : { not: null },
        ...(query.filter === "reply" ? { lastMessageSender: "CONSUMER" as const } : {}),
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
    await this.open.assertOpen();
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
    await this.open.assertOpen();
    const t = await this.getStoreThread(storeId, threadId);
    return this.listMessages("SHOP", t, sellerId, query);
  }

  async sendForStore(sellerId: string, storeId: string, threadId: string, dto: ChatSendDto) {
    await this.assertStoreOwner(sellerId, storeId);
    await this.open.assertOpen();
    if (!(await this.hasAgreed("SELLER", sellerId))) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.RULES_NOT_AGREED);
    }
    const t = await this.getStoreThread(storeId, threadId);
    const w = this.writeState("SHOP", t, await this.hasActiveOrder(t.consumerId, storeId));
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
    await this.open.assertOpen();
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
      ? this.writeState("SHOP", thread, await this.hasActiveOrder(order.consumerId, storeId))
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
    await this.open.assertOpen();
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
    const w = this.writeState("SHOP", thread, await this.hasActiveOrder(order.consumerId, storeId));
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
    await this.open.assertOpen();
    await this.getStoreThread(storeId, threadId);
    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: flag === "mute" ? { shopMuted: value } : { blockedByShopAt: value ? new Date() : null },
    });
    return this.threadForStore(sellerId, storeId, threadId);
  }

  async reportForStore(sellerId: string, storeId: string, threadId: string, dto: ChatReportDto) {
    await this.assertStoreOwner(sellerId, storeId);
    await this.open.assertOpen();
    const t = await this.getStoreThread(storeId, threadId);
    return this.report("SHOP", sellerId, t, dto);
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
