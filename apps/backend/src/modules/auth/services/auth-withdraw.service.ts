import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import {
  AUTH_ERROR_MESSAGES,
  AudienceConst,
  AUDIENCE,
  REVIEW_LOGIN_ACCOUNT_PHONE_MARKER,
  SELLER_REVIEW_ACCOUNT_PHONE_MARKER,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";
import {
  ORDER_STATUSES_BLOCKING_ACCOUNT_WITHDRAWAL,
  OrderStatus,
} from "@apps/backend/modules/order/constants/order.constants";
import { AuthAppleOauthService } from "@apps/backend/modules/auth/services/auth-apple-oauth.service";
import { AuthKakaoOauthService } from "@apps/backend/modules/auth/services/auth-kakao-oauth.service";
import { AuthNaverOauthService } from "@apps/backend/modules/auth/services/auth-naver-oauth.service";
import { UploadService } from "@apps/backend/modules/upload/upload.service";

/**
 * 회원 탈퇴 — 계정을 "익명화 후 비활성화" 처리합니다(하드 삭제 아님).
 *
 * 전자상거래법상 계약·청약철회(5년), 대금결제·재화공급(5년), 소비자 분쟁처리(3년) 기록은
 * 탈퇴 이후에도 법정 보존 기간 동안 남아 있어야 합니다. Consumer/Seller row를 물리 삭제하면
 * Prisma `onDelete: Cascade`로 연결된 Order/OrderItem/약관동의이력까지 즉시 삭제되어 이 의무를
 * 위반하게 되므로, 계정 row 자체는 남기고 개인정보 보호법상 더 이상 보유할 필요가 없는 식별 정보만
 * 파기(null 처리·토큰화)합니다.
 *
 * - `isActive: false` — 세션 즉시 무효화(`JwtStrategy.validateConsumer/validateSeller`가 참조),
 *   관리자 회원 목록 등에서 활성 회원과 구분(`withdrawnAt` 존재 여부로 관리자 비활성화와 구분됨).
 * - `phone`/`googleId`/`kakaoId` 등 재가입 식별에 쓰이는 값은 파기 후 고유값으로 치환해, 관리자
 *   비활성(정지)과 달리 동일 OAuth·휴대폰으로 즉시 재가입이 가능하도록 유지합니다.
 * - `name`/`nickname`/`profileImageUrl` 등 더 이상 필요 없는 개인정보는 null 처리합니다.
 * - 카카오·네이버로 가입했으면 그 연결을 끊습니다(애플 revoke와 같게, 실패해도 탈퇴는 진행). 손님·사장님이 같은 카카오·네이버 앱을 써서
 *   같은 계정으로 가입한 다른 역할 계정이 남아 있으면 끊지 않습니다(네이버는 상용에서만 끊음 — `AuthNaverOauthService.revoke`). 끊기·revoke는 DB에서 탈퇴 처리를 마친 뒤에 합니다
 *   (먼저 끊고 DB 저장이 실패하면 계정은 살아 있는데 카카오만 끊긴 반쯤 탈퇴가 된다).
 * - 견적 요청(사진 포함)은 계약이 아니라 보관 의무가 없어 지웁니다(QuoteRequestCleanupService).
 * - 케이크 디자인 모음 좋아요(DesignLike)도 지웁니다(디자인별 좋아요 수에서 빠지게).
 * - 주문(Order)·주문상품(OrderItem)·약관동의이력은 그대로 보존됩니다(법정 보존기간 경과 후 별도
 *   배치로 파기 필요 — 현재 미구현, 후속 작업).
 */
import { QuoteRequestCleanupService } from "@apps/backend/modules/quote-request/services/quote-request-cleanup.service";
import { ChatCleanupService } from "@apps/backend/modules/chat/services/chat-cleanup.service";
import { ManualOrderService } from "@apps/backend/modules/manual-order/services/manual-order.service";
@Injectable()
export class AuthWithdrawService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAppleOauthService: AuthAppleOauthService,
    private readonly authKakaoOauthService: AuthKakaoOauthService,
    private readonly authNaverOauthService: AuthNaverOauthService,
    private readonly quoteRequestCleanup: QuoteRequestCleanupService,
    private readonly chatCleanup: ChatCleanupService,
    private readonly manualOrderService: ManualOrderService,
    private readonly uploadService: UploadService,
  ) {}

  async withdraw(audience: AudienceConst, accountId: string, reason: string): Promise<void> {
    LoggerUtil.log(
      `회원 탈퇴 요청: audience=${audience}, accountId=${accountId}, reasonLength=${reason.length}`,
    );

    if (audience === AUDIENCE.CONSUMER) {
      const row = await this.prisma.consumer.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          phone: true,
          withdrawnAt: true,
          profileImageUrl: true,
          appleRefreshToken: true,
          kakaoId: true,
          naverId: true,
          naverRefreshToken: true,
        },
      });
      if (!row) {
        throw new NotFoundException(AUTH_ERROR_MESSAGES.USER_NOT_FOUND);
      }
      if (row.withdrawnAt) {
        // 이미 탈퇴 처리된 계정(중복 요청 등) — 재차 익명화하지 않음
        throw new NotFoundException(AUTH_ERROR_MESSAGES.USER_NOT_FOUND);
      }

      if (row.phone === REVIEW_LOGIN_ACCOUNT_PHONE_MARKER) {
        // 손님 앱 심사용 계정: 심사관이 예약해 본 뒤 탈퇴까지 확인할 수 있게 진행 중 예약을 취소로 돌리고 탈퇴한다
        // (판매자 심사 계정과 같게, App Store 5.1.1(v)). 다음 심사용 로그인 때 새 심사 계정이 만들어진다(phone이 바뀜)
        await this.prisma.order.updateMany({
          where: {
            consumerId: accountId,
            orderStatus: { in: ORDER_STATUSES_BLOCKING_ACCOUNT_WITHDRAWAL },
          },
          data: {
            orderStatus: OrderStatus.CANCEL_COMPLETED,
            canceledAt: new Date(),
            userCancelReason: "심사용 계정 탈퇴",
          },
        });
      } else {
        await this.assertNoActiveOrdersForConsumer(accountId);
      }

      // 견적 요청은 주문(계약)이 아니라 보관 의무가 없어 탈퇴하면 사진과 함께 지운다(기획 I-46)
      await this.quoteRequestCleanup.deleteAllForConsumer(accountId);
      // 채팅 글·사진도 바로 지운다(기획 I-11, 운영자 결정 11-11). 방은 가게 쪽에 "탈퇴한 손님"으로 남는다
      await this.chatCleanup.deleteAllForConsumer(accountId);
      // 디자인 모음 좋아요는 웹에서 디자인별 수로 보이므로 탈퇴한 손님 것은 지운다(기획 I-112).
      // 계정을 익명화만 해서 onDelete: Cascade로는 지워지지 않는다
      await this.prisma.designLike.deleteMany({ where: { consumerId: accountId } });
      // 휴대폰 알림 기기도 지운다(사장님 탈퇴와 같게). 남겨 두면 탈퇴 뒤 관리자 환불 되돌리기 등 알림이 그 기기로 간다
      await this.prisma.consumerFcmToken.deleteMany({ where: { consumerId: accountId } });

      await this.prisma.consumer.update({
        where: { id: accountId },
        data: {
          ...this.buildAnonymizedWithdrawalData(accountId, reason),
          // Apple 필드는 Consumer 전용(Seller는 미지원)이라 공용 빌더에 넣지 않고 여기서만 null 처리
          appleId: null,
          appleEmail: null,
          appleRefreshToken: null,
        },
      });

      // 프로필 사진 파일도 지운다(처리방침 "탈퇴 후 즉시 파기"). 계정 행을 비운 뒤라 이 사진을 쓰는 곳이 없으면 지워진다
      await this.deleteProfileImageFile(AUDIENCE.CONSUMER, row.profileImageUrl);

      // 바깥 연결 끊기는 탈퇴 처리를 마친 뒤(읽어 둔 값으로). 무엇이 실패해도 탈퇴는 끝난 상태로 둔다.
      await this.afterWithdrawal(AUDIENCE.CONSUMER, async () => {
        // Apple 가이드라인 5.1.1(v) — 계정 삭제 시 Sign in with Apple 인가를 revoke.
        if (row.appleRefreshToken) {
          await this.authAppleOauthService.revokeToken(row.appleRefreshToken);
        }
        // 카카오 연결 끊기 — 카카오에 남은 동의가 없어져 다시 가입할 때 동의부터 새로 받는다.
        // 같은 카카오로 가입한 사장님 계정이 있으면 끊지 않는다(같은 카카오 앱이라 사장님 연결도 같이 끊긴다).
        if (row.kakaoId && !(await this.hasOtherRoleWithKakaoId(AUDIENCE.SELLER, row.kakaoId))) {
          await this.authKakaoOauthService.unlink(AUDIENCE.CONSUMER, row.kakaoId);
        }
        // 네이버 연결 끊기 — 같은 네이버로 가입한 사장님 계정이 있으면 끊지 않는다(같은 네이버 앱이라 사장님 연결도 같이 끊긴다)
        if (row.naverId && !(await this.hasOtherRoleWithNaverId(AUDIENCE.SELLER, row.naverId))) {
          await this.authNaverOauthService.revoke(AUDIENCE.CONSUMER, row.naverRefreshToken);
        }
      });
      return;
    }

    if (audience === AUDIENCE.SELLER) {
      const row = await this.prisma.seller.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          withdrawnAt: true,
          profileImageUrl: true,
          phone: true,
          kakaoId: true,
          naverId: true,
          naverRefreshToken: true,
        },
      });
      if (!row) {
        throw new NotFoundException(AUTH_ERROR_MESSAGES.USER_NOT_FOUND);
      }
      if (row.withdrawnAt) {
        throw new NotFoundException(AUTH_ERROR_MESSAGES.USER_NOT_FOUND);
      }

      if (row.phone === SELLER_REVIEW_ACCOUNT_PHONE_MARKER) {
        // 판매자 앱 심사용 계정(I-48): 심사관이 탈퇴까지 확인할 수 있게 예시 주문이 진행 중이어도 탈퇴한다.
        // 예시 가게·상품·주문은 보존할 실제 거래가 아니므로 지우고, 다음 심사용 로그인 때 다시 만든다.
        // 직접 적은 주문은 가게를 지우면 행이 같이 지워져 사진 파일이 남으므로 먼저 지운다
        await this.manualOrderService.deleteAllForSeller(accountId);
        await this.prisma.store.deleteMany({
          where: { sellerId: accountId, businessNo: REVIEW_STORE_BUSINESS_NO },
        });
      } else {
        await this.assertNoActiveOrdersForSeller(accountId);
      }
      await this.prisma.seller.update({
        where: { id: accountId },
        data: this.buildAnonymizedWithdrawalData(accountId, reason),
      });
      // 탈퇴한 판매자의 휴대폰으로 더 이상 푸시가 가지 않게 판매자 앱 토큰을 지움
      await this.prisma.sellerFcmToken.deleteMany({ where: { sellerId: accountId } });
      // 직접 적은 주문(기획 I-42)은 Picake 거래가 아닌 사장님 장부라 남길 까닭이 없다. 다른 캘린더로 내보낸
      // 주소를 먼저 끊고, 손님 이름·사진이 있어 행과 사진 파일을 지운다(사진 지우기 실패는 탈퇴를 막지 않음)
      await this.prisma.store.updateMany({
        where: { sellerId: accountId },
        data: { calendarFeedToken: null },
      });
      await this.manualOrderService.deleteAllForSeller(accountId);
      // 프로필 사진 파일도 지운다(처리방침 "탈퇴 후 즉시 파기")
      await this.deleteProfileImageFile(AUDIENCE.SELLER, row.profileImageUrl);
      await this.afterWithdrawal(AUDIENCE.SELLER, async () => {
        // 카카오 연결 끊기(탈퇴 처리를 마친 뒤). 같은 카카오로 가입한 손님 계정이 있으면 끊지 않는다
        if (row.kakaoId && !(await this.hasOtherRoleWithKakaoId(AUDIENCE.CONSUMER, row.kakaoId))) {
          await this.authKakaoOauthService.unlink(AUDIENCE.SELLER, row.kakaoId);
        }
        // 네이버 연결 끊기. 같은 네이버로 가입한 손님 계정이 있으면 끊지 않는다
        if (row.naverId && !(await this.hasOtherRoleWithNaverId(AUDIENCE.CONSUMER, row.naverId))) {
          await this.authNaverOauthService.revoke(AUDIENCE.SELLER, row.naverRefreshToken);
        }
      });
      return;
    }

    if (audience === AUDIENCE.ADMIN) {
      // 관리자 계정은 소비자 보호 법령상 거래기록 보존 의무 대상이 아니므로 기존과 동일하게 완전
      // 삭제합니다.
      const row = await this.prisma.admin.findUnique({
        where: { id: accountId },
        select: { id: true },
      });
      if (!row) {
        throw new NotFoundException(AUTH_ERROR_MESSAGES.USER_NOT_FOUND);
      }
      await this.prisma.admin.delete({ where: { id: accountId } });
      return;
    }

    throw new NotFoundException(AUTH_ERROR_MESSAGES.USER_NOT_FOUND);
  }

  /**
   * 탈퇴를 DB에 마친 뒤 하는 바깥 연결 끊기(애플 해지·카카오·네이버). 끊기 함수들은 바깥 API 실패를 스스로 잡지만,
   * "같은 계정의 다른 역할" 확인 같은 DB 조회가 실패하면 예외가 올라가 이미 끝난 탈퇴에 500이 났다
   * (다시 누르면 "계정을 찾을 수 없어요") — 여기서 잡아 기록만 하고 탈퇴는 성공으로 둔다(11-16 검토).
   */
  /**
   * 탈퇴한 계정의 프로필 사진 파일 지우기. 계정 행의 사진 주소를 비운 뒤에 불러야 그 행을 참조로 세지 않는다.
   * 우리 저장소에 올린 사진만 지우고(구글 프로필 사진 같은 바깥 주소는 건너뜀), 다른 곳이 같은 파일을 쓰면 남긴다.
   * 실패해도 탈퇴는 끝난 상태로 둔다.
   */
  private async deleteProfileImageFile(audience: AudienceConst, url: string | null): Promise<void> {
    if (!url) return;
    try {
      await this.uploadService.deleteFilesByUrl([url]);
    } catch (error) {
      LoggerUtil.log(`탈퇴 뒤 프로필 사진 지우기 실패(탈퇴는 완료): audience=${audience}`);
      SentryUtil.captureException(error, "warning", {
        module: "auth-withdraw",
        step: "profile-image",
      });
    }
  }

  private async afterWithdrawal(audience: AudienceConst, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      LoggerUtil.log(`탈퇴 뒤 연결 끊기 실패(탈퇴는 완료): audience=${audience}`);
      SentryUtil.captureException(error, "warning", {
        module: "auth-withdraw",
        step: "after-withdrawal",
      });
    }
  }

  /**
   * 같은 카카오 계정으로 가입한 다른 역할(손님↔사장님) 계정이 있는지. 탈퇴하면 kakaoId를 비우므로 남아 있으면 살아 있는(또는 정지된) 계정이다.
   * 손님·사장님은 같은 카카오 앱(키만 둘)이라 회원번호가 같고, 연결을 끊으면 그 계정의 카카오 연결도 같이 끊긴다.
   */
  private async hasOtherRoleWithKakaoId(
    other: typeof AUDIENCE.CONSUMER | typeof AUDIENCE.SELLER,
    kakaoId: string,
  ): Promise<boolean> {
    const found =
      other === AUDIENCE.SELLER
        ? await this.prisma.seller.findFirst({ where: { kakaoId }, select: { id: true } })
        : await this.prisma.consumer.findFirst({ where: { kakaoId }, select: { id: true } });
    if (found) {
      LoggerUtil.log(
        `카카오 연결 끊기 건너뜀: 같은 카카오로 가입한 다른 역할 계정이 있음(${other})`,
      );
    }
    return Boolean(found);
  }

  /** 같은 네이버 계정으로 가입한 다른 역할 계정이 있는지(손님·사장님이 네이버 앱 하나를 같이 써서 naverId가 같다) */
  private async hasOtherRoleWithNaverId(
    other: typeof AUDIENCE.CONSUMER | typeof AUDIENCE.SELLER,
    naverId: string,
  ): Promise<boolean> {
    const found =
      other === AUDIENCE.SELLER
        ? await this.prisma.seller.findFirst({ where: { naverId }, select: { id: true } })
        : await this.prisma.consumer.findFirst({ where: { naverId }, select: { id: true } });
    if (found) {
      LoggerUtil.log(
        `네이버 연결 끊기 건너뜀: 같은 네이버로 가입한 다른 역할 계정이 있음(${other})`,
      );
    }
    return Boolean(found);
  }

  /**
   * 탈퇴 시 Consumer/Seller에 공통 적용할 익명화 데이터.
   * `phone`은 `@unique` 필수 컬럼이라 null 처리가 불가능해 계정 id 기반의 재사용 불가능한 값으로
   * 치환합니다(원래 번호는 어디에도 남지 않음). `googleId`/`kakaoId`는 nullable+unique라 null 처리로
   * 충분합니다(Postgres는 unique 컬럼의 null 다중값을 허용).
   */
  private buildAnonymizedWithdrawalData(accountId: string, reason: string) {
    return {
      isActive: false,
      withdrawnAt: new Date(),
      withdrawReason: reason,
      phone: `withdrawn_${accountId}`,
      isPhoneVerified: false,
      name: null,
      nickname: null,
      profileImageUrl: null,
      googleId: null,
      googleEmail: null,
      kakaoId: null,
      kakaoEmail: null,
      naverId: null,
      naverRefreshToken: null,
    };
  }

  private async assertNoActiveOrdersForConsumer(consumerId: string): Promise<void> {
    const activeOrderCount = await this.prisma.order.count({
      where: {
        consumerId,
        orderStatus: { in: ORDER_STATUSES_BLOCKING_ACCOUNT_WITHDRAWAL },
      },
    });
    if (activeOrderCount > 0) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.WITHDRAW_BLOCKED_ACTIVE_ORDERS);
    }
  }

  private async assertNoActiveOrdersForSeller(sellerId: string): Promise<void> {
    const activeOrderCount = await this.prisma.order.count({
      where: {
        orderStatus: { in: ORDER_STATUSES_BLOCKING_ACCOUNT_WITHDRAWAL },
        store: { sellerId },
      },
    });
    if (activeOrderCount > 0) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.WITHDRAW_BLOCKED_ACTIVE_ORDERS);
    }
  }
}
