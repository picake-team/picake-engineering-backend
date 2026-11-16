import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Order } from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import {
  isPickupPendingDue,
  isPickupReminderDue,
  isPickupReminderLeadEligible,
  isPaymentPendingExpired,
  isPaymentFinalReminderDue,
  isPaymentFinalReminderEligible,
  isPaymentReminderDue,
  isPaymentReminderEligible,
  isReservationRequestExpired,
  shouldNotifyReservationExpiry,
  PICKUP_REMINDER_LEAD_MS,
  PAYMENT_FINAL_REMINDER_LEAD_MS,
  PAYMENT_REMINDER_LEAD_MS,
} from "@apps/backend/modules/order/utils/order-datetime.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { OrderLifecycleHookService } from "@apps/backend/modules/order/services/order-lifecycle-hook.service";
import { NotificationOrderDispatchService } from "@apps/backend/modules/notification/services/notification-order-dispatch.service";
import {
  ORDER_STATUS_TRANSITION_SOURCE,
  type OrderStatusTransitionSource,
} from "@apps/backend/modules/order/types/order-lifecycle.types";

/**
 * 입금대기 만료, 확인하지 않은 예약신청 만료, 픽업 시각 도달 자동 전환, 픽업 24시간 전 안내 등 주문 자동화
 */
@Injectable()
export class OrderAutomationService implements OnModuleInit, OnModuleDestroy {
  private batchTimer?: ReturnType<typeof setInterval>;
  private readonly batchIntervalMs = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderLifecycleHookService: OrderLifecycleHookService,
    private readonly notificationOrderDispatchService: NotificationOrderDispatchService,
  ) {}

  onModuleInit(): void {
    void this.runBatchTransitions();
    this.batchTimer = setInterval(() => void this.runBatchTransitions(), this.batchIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
  }

  /**
   * 단일 주문에 대해 만료·픽업 전환·픽업 안내 규칙을 즉시 적용 (최신 상태 보장)
   * 만료 규칙: 입금대기 상태에서 `paymentPendingDeadlineAt`(없으면 픽업·진입 시각 기준 복원)이 지난 주문을 취소완료로 전환합니다.
   * 예약신청 만료: 가게가 픽업 날이 지나도록(그날 자정, 한국 시간) 확인하지 않은 예약신청을 취소완료로 전환합니다(`reservationExpiredAt`, 2026-11-16).
   *   답이 없는 예약신청이 영원히 "진행 중"으로 남아 손님이 탈퇴하지 못하던 것. 만료된 지 하루가 넘은 건은 알림 없이 취소합니다.
   * 재입금 안내(1차): 입금대기 상태에서 마감까지 준 시간이 3시간 초과인 주문에 한해, 마감 3시간 전 구매자 안내를 1회 발송합니다. (마감 구간이 1시간으로 짧게 잡힌 픽업 임박 주문은 생략)
   * 재입금 안내(2차): 마감 30분 전 최종 안내를 1회 발송합니다. 1차와 달리 창구가 짧은 주문도 대상입니다(창구가 30분 이하면 생략).
   * 픽업 안내: 예약확정 상태에서 픽업 24시간 전이면 구매자 안내를 1회 발송합니다. (주문~픽업이 24시간 미만이면 생략)
   * 픽업 규칙: 예약확정 상태에서 픽업 시각이 도달했거나 지난 주문을 픽업대기로 전환합니다.
   */
  async syncOrderLifecycleById(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return;
    }
    await this.syncLoadedOrder(order);
  }

  /**
   * 목록에서 이미 읽은 주문 줄로 같은 규칙을 적용한다(주문마다 다시 읽지 않음).
   * 바뀔 수 있는 상태(입금대기·예약확정)만 보고, 상태가 바뀐 주문이 있으면 true → 목록을 다시 읽는다.
   */
  async syncLoadedOrders(orders: Order[]): Promise<boolean> {
    const targets = orders.filter(
      (o) =>
        o.orderStatus === OrderStatus.PAYMENT_PENDING ||
        ((o.orderStatus === OrderStatus.CONFIRMED ||
          o.orderStatus === OrderStatus.RESERVATION_REQUESTED) &&
          o.pickupDate),
    );
    if (targets.length === 0) return false;
    const changed = await Promise.all(targets.map((o) => this.syncLoadedOrder(o)));
    return changed.some(Boolean);
  }

  /** 주문 줄 하나에 자동화 규칙을 적용하고, 상태를 바꿨으면 true */
  private async syncLoadedOrder(order: Order): Promise<boolean> {
    const orderId = order.id;
    const now = new Date();

    if (order.orderStatus === OrderStatus.PAYMENT_PENDING) {
      const expiryInput = {
        paymentPendingDeadlineAt: order.paymentPendingDeadlineAt,
        paymentPendingAt: order.paymentPendingAt,
        createdAt: order.createdAt,
        pickupDate: order.pickupDate,
      };
      if (isPaymentPendingExpired(now, expiryInput)) {
        const { count } = await this.prisma.order.updateMany({
          where: { id: orderId, orderStatus: OrderStatus.PAYMENT_PENDING },
          data: {
            orderStatus: OrderStatus.CANCEL_COMPLETED,
            paymentPendingExpiredAt: now,
            canceledAt: now,
          },
        });
        if (count === 1) {
          this.orderLifecycleHookService.afterOrderStatusTransition({
            orderId,
            fromStatus: OrderStatus.PAYMENT_PENDING,
            toStatus: OrderStatus.CANCEL_COMPLETED,
            source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC,
          });
          return true;
        }
      } else if (order.paymentPendingAt && order.paymentPendingDeadlineAt) {
        await this.trySendPaymentFinalReminder({
          orderId,
          paymentPendingAt: order.paymentPendingAt,
          paymentPendingDeadlineAt: order.paymentPendingDeadlineAt,
          paymentFinalReminderSentAt: order.paymentFinalReminderSentAt,
          now,
        });
        await this.trySendPaymentReminder({
          orderId,
          paymentPendingAt: order.paymentPendingAt,
          paymentPendingDeadlineAt: order.paymentPendingDeadlineAt,
          paymentReminderSentAt: order.paymentReminderSentAt,
          now,
        });
      }
      return false;
    }

    if (order.orderStatus === OrderStatus.RESERVATION_REQUESTED && order.pickupDate) {
      return this.tryExpireReservationRequest(
        orderId,
        order.pickupDate,
        now,
        ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC,
      );
    }

    if (order.orderStatus === OrderStatus.CONFIRMED && order.pickupDate) {
      await this.trySendPickupReminder({
        orderId,
        createdAt: order.createdAt,
        pickupDate: order.pickupDate,
        pickupReminderSentAt: order.pickupReminderSentAt,
        now,
      });

      if (isPickupPendingDue(order.pickupDate, now)) {
        const { count } = await this.prisma.order.updateMany({
          where: {
            id: orderId,
            orderStatus: OrderStatus.CONFIRMED,
          },
          data: { orderStatus: OrderStatus.PICKUP_PENDING },
        });
        if (count === 1) {
          this.orderLifecycleHookService.afterOrderStatusTransition({
            orderId,
            fromStatus: OrderStatus.CONFIRMED,
            toStatus: OrderStatus.PICKUP_PENDING,
            source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_SYNC,
          });
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 앱(모듈)이 기동된 직후 5분마다 실행되며 주문 상태 자동화
   * 전체 주문에 대해 `syncOrderLifecycleById`와 **같은 조건**으로 상태를 맞춥니다.
   */
  async runBatchTransitions(): Promise<void> {
    try {
      const now = new Date();

      const paymentPendingRows = await this.prisma.order.findMany({
        where: {
          orderStatus: OrderStatus.PAYMENT_PENDING,
          OR: [{ paymentPendingDeadlineAt: { lte: now } }, { paymentPendingDeadlineAt: null }],
        },
        select: {
          id: true,
          paymentPendingDeadlineAt: true,
          paymentPendingAt: true,
          createdAt: true,
          pickupDate: true,
        },
      });

      for (const row of paymentPendingRows) {
        if (!isPaymentPendingExpired(now, row)) {
          continue;
        }
        const { count } = await this.prisma.order.updateMany({
          where: { id: row.id, orderStatus: OrderStatus.PAYMENT_PENDING },
          data: {
            orderStatus: OrderStatus.CANCEL_COMPLETED,
            paymentPendingExpiredAt: now,
            canceledAt: now,
          },
        });
        if (count === 1) {
          this.orderLifecycleHookService.afterOrderStatusTransition({
            orderId: row.id,
            fromStatus: OrderStatus.PAYMENT_PENDING,
            toStatus: OrderStatus.CANCEL_COMPLETED,
            source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
          });
        }
      }

      // 가게가 픽업 날이 지나도록 확인하지 않은 예약신청 (sync의 RESERVATION_REQUESTED 분기와 같음)
      const reservationRequestRows = await this.prisma.order.findMany({
        where: {
          orderStatus: OrderStatus.RESERVATION_REQUESTED,
          pickupDate: { lte: now },
        },
        select: { id: true, pickupDate: true },
      });

      for (const row of reservationRequestRows) {
        if (!row.pickupDate) continue;
        await this.tryExpireReservationRequest(
          row.id,
          row.pickupDate,
          now,
          ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
        );
      }

      // 재입금 안내 (입금대기 · 미발송 · 마감이 아직 남음)
      const paymentReminderWindowEnd = new Date(now.getTime() + PAYMENT_REMINDER_LEAD_MS);
      const paymentReminderCandidates = await this.prisma.order.findMany({
        where: {
          orderStatus: OrderStatus.PAYMENT_PENDING,
          paymentReminderSentAt: null,
          paymentPendingAt: { not: null },
          paymentPendingDeadlineAt: {
            gt: now,
            lte: paymentReminderWindowEnd,
          },
        },
        select: {
          id: true,
          paymentPendingAt: true,
          paymentPendingDeadlineAt: true,
          paymentReminderSentAt: true,
        },
      });

      for (const row of paymentReminderCandidates) {
        if (!row.paymentPendingAt || !row.paymentPendingDeadlineAt) continue;
        await this.trySendPaymentReminder({
          orderId: row.id,
          paymentPendingAt: row.paymentPendingAt,
          paymentPendingDeadlineAt: row.paymentPendingDeadlineAt,
          paymentReminderSentAt: row.paymentReminderSentAt,
          now,
        });
      }

      // 입금 마감 30분 전 2차 안내 (입금대기 · 미발송 · 마감이 아직 남음)
      const paymentFinalWindowEnd = new Date(now.getTime() + PAYMENT_FINAL_REMINDER_LEAD_MS);
      const paymentFinalCandidates = await this.prisma.order.findMany({
        where: {
          orderStatus: OrderStatus.PAYMENT_PENDING,
          paymentFinalReminderSentAt: null,
          paymentPendingAt: { not: null },
          paymentPendingDeadlineAt: {
            gt: now,
            lte: paymentFinalWindowEnd,
          },
        },
        select: {
          id: true,
          paymentPendingAt: true,
          paymentPendingDeadlineAt: true,
          paymentFinalReminderSentAt: true,
        },
      });

      for (const row of paymentFinalCandidates) {
        if (!row.paymentPendingAt || !row.paymentPendingDeadlineAt) continue;
        await this.trySendPaymentFinalReminder({
          orderId: row.id,
          paymentPendingAt: row.paymentPendingAt,
          paymentPendingDeadlineAt: row.paymentPendingDeadlineAt,
          paymentFinalReminderSentAt: row.paymentFinalReminderSentAt,
          now,
        });
      }

      // 픽업 24시간 전 안내 (예약확정 · 미발송 · 픽업이 아직 남음)
      const reminderWindowEnd = new Date(now.getTime() + PICKUP_REMINDER_LEAD_MS);
      const reminderCandidates = await this.prisma.order.findMany({
        where: {
          orderStatus: OrderStatus.CONFIRMED,
          pickupReminderSentAt: null,
          pickupDate: {
            gt: now,
            lte: reminderWindowEnd,
          },
        },
        select: {
          id: true,
          createdAt: true,
          pickupDate: true,
          pickupReminderSentAt: true,
        },
      });

      for (const row of reminderCandidates) {
        if (!row.pickupDate) continue;
        await this.trySendPickupReminder({
          orderId: row.id,
          createdAt: row.createdAt,
          pickupDate: row.pickupDate,
          pickupReminderSentAt: row.pickupReminderSentAt,
          now,
        });
      }

      // sync의 `CONFIRMED && pickupDate && isPickupPendingDue`와 동일
      const confirmedWithPickup = await this.prisma.order.findMany({
        where: {
          orderStatus: OrderStatus.CONFIRMED,
          pickupDate: { lte: now },
        },
        select: { id: true, pickupDate: true },
      });

      for (const row of confirmedWithPickup) {
        if (!row.pickupDate || !isPickupPendingDue(row.pickupDate, now)) {
          continue;
        }
        // `syncOrderLifecycleById`와 경합해도 훅은 실제 전환이 1건만 일어났을 때만 발화
        const { count } = await this.prisma.order.updateMany({
          where: {
            id: row.id,
            orderStatus: OrderStatus.CONFIRMED,
          },
          data: { orderStatus: OrderStatus.PICKUP_PENDING },
        });
        if (count === 1) {
          this.orderLifecycleHookService.afterOrderStatusTransition({
            orderId: row.id,
            fromStatus: OrderStatus.CONFIRMED,
            toStatus: OrderStatus.PICKUP_PENDING,
            source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
          });
        }
      }
    } catch (e) {
      LoggerUtil.log(`주문 자동 전환 배치 실패: ${e instanceof Error ? e.message : String(e)}`);
      SentryUtil.captureException(e, "error", {
        module: "order-automation",
        job: "runBatchTransitions",
        source: ORDER_STATUS_TRANSITION_SOURCE.AUTOMATION_BATCH,
      });
    }
  }

  /**
   * 가게가 픽업 날이 지나도록 확인하지 않은 예약신청을 취소완료로 바꿉니다. 바꿨으면 true.
   * - 입금 전(예약신청)이라 돈이 오간 적이 없어 환불 단계 없이 취소완료.
   * - 상태 조건부 update라 배치·sync·사장님 확인이 겹쳐도 한 번만 바뀝니다(사장님이 먼저 확인했으면 그대로).
   * - 만료된 지 하루가 넘은 건(첫 배포 때 쌓인 옛 주문)은 알림 훅을 부르지 않습니다.
   */
  private async tryExpireReservationRequest(
    orderId: string,
    pickupDate: Date,
    now: Date,
    source: OrderStatusTransitionSource,
  ): Promise<boolean> {
    if (!isReservationRequestExpired(pickupDate, now)) return false;
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, orderStatus: OrderStatus.RESERVATION_REQUESTED },
      data: {
        orderStatus: OrderStatus.CANCEL_COMPLETED,
        reservationExpiredAt: now,
        canceledAt: now,
      },
    });
    if (count !== 1) return false;
    if (shouldNotifyReservationExpiry(pickupDate, now)) {
      this.orderLifecycleHookService.afterOrderStatusTransition({
        orderId,
        fromStatus: OrderStatus.RESERVATION_REQUESTED,
        toStatus: OrderStatus.CANCEL_COMPLETED,
        source,
      });
    } else {
      LoggerUtil.log(
        `[OrderLifecycle] ${source} order=${orderId} RESERVATION_REQUESTED → CANCEL_COMPLETED (오래된 예약신청, 알림 없음)`,
      );
    }
    return true;
  }

  /**
   * 픽업 24시간 전 안내를 1회만 발송합니다.
   * - 주문 생성~픽업이 24시간 미만이면 발송하지 않습니다.
   * - `pickupReminderSentAt`을 먼저 확정해 배치·sync 경합 시 중복 발송을 막습니다.
   */
  private async trySendPickupReminder(params: {
    orderId: string;
    createdAt: Date;
    pickupDate: Date;
    pickupReminderSentAt: Date | null;
    now: Date;
  }): Promise<void> {
    const { orderId, createdAt, pickupDate, pickupReminderSentAt, now } = params;
    if (pickupReminderSentAt) return;
    if (!isPickupReminderLeadEligible(createdAt, pickupDate)) return;
    if (!isPickupReminderDue(pickupDate, now)) return;

    const { count } = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        orderStatus: OrderStatus.CONFIRMED,
        pickupReminderSentAt: null,
      },
      data: { pickupReminderSentAt: now },
    });
    if (count !== 1) return;

    await this.notificationOrderDispatchService.handlePickupReminder(orderId);
  }

  /**
   * 재입금 안내를 1회만 발송합니다.
   * - 마감까지 준 시간이 3시간(리드타임) 이하면(픽업 임박으로 짧게 잡힌 마감) 발송하지 않습니다.
   * - `paymentReminderSentAt`을 먼저 확정해 배치·sync 경합 시 중복 발송을 막습니다.
   */
  private async trySendPaymentReminder(params: {
    orderId: string;
    paymentPendingAt: Date;
    paymentPendingDeadlineAt: Date;
    paymentReminderSentAt: Date | null;
    now: Date;
  }): Promise<void> {
    const { orderId, paymentPendingAt, paymentPendingDeadlineAt, paymentReminderSentAt, now } =
      params;
    if (paymentReminderSentAt) return;
    if (!isPaymentReminderEligible(paymentPendingAt, paymentPendingDeadlineAt)) return;
    if (!isPaymentReminderDue(paymentPendingDeadlineAt, now)) return;

    const { count } = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        orderStatus: OrderStatus.PAYMENT_PENDING,
        paymentReminderSentAt: null,
      },
      data: { paymentReminderSentAt: now },
    });
    if (count !== 1) return;

    await this.notificationOrderDispatchService.handlePaymentReminder(orderId);
  }

  /**
   * 입금 마감 30분 전 2차(최종) 안내를 1회만 발송합니다.
   *
   * 1차(3시간 전)와 달리 입금 창구가 짧은 주문도 대상입니다. 픽업 임박으로 창구가 1시간인 주문은
   * 1차 안내를 받지 못하는데, 시간이 가장 촉박해 놓치기 쉬운 건들이라 2차는 반드시 닿아야 합니다.
   * `paymentFinalReminderSentAt`을 먼저 확정해 배치·sync 경합 시 중복 발송을 막습니다.
   */
  private async trySendPaymentFinalReminder(params: {
    orderId: string;
    paymentPendingAt: Date;
    paymentPendingDeadlineAt: Date;
    paymentFinalReminderSentAt: Date | null;
    now: Date;
  }): Promise<void> {
    const { orderId, paymentPendingAt, paymentPendingDeadlineAt, paymentFinalReminderSentAt, now } =
      params;
    if (paymentFinalReminderSentAt) return;
    if (!isPaymentFinalReminderEligible(paymentPendingAt, paymentPendingDeadlineAt)) return;
    if (!isPaymentFinalReminderDue(paymentPendingDeadlineAt, now)) return;

    const { count } = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        orderStatus: OrderStatus.PAYMENT_PENDING,
        paymentFinalReminderSentAt: null,
      },
      data: { paymentFinalReminderSentAt: now },
    });
    if (count !== 1) return;

    await this.notificationOrderDispatchService.handlePaymentFinalReminder(orderId);
  }
}
