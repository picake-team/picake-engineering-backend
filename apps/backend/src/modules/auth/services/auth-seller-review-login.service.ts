import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Prisma,
  SellerVerificationStatus,
  TermsType,
} from "@apps/backend/infra/database/prisma/generated/client";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import {
  AUDIENCE,
  AUTH_ERROR_MESSAGES,
  SELLER_REVIEW_ACCOUNT_PHONE_MARKER,
  SELLER_REVIEW_LOGIN_CODE_HASH_ENV,
  SELLER_REVIEW_SAMPLE_CONSUMER_PHONE_MARKER,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { ReviewLoginRequestDto } from "@apps/backend/modules/auth/dto/auth-review-login.dto";
import {
  REVIEW_SAMPLE_PRODUCTS,
  SELLER_REVIEW_SAMPLE,
  buildReviewProductCreateData,
  buildReviewSampleOrders,
  buildReviewStoreCreateData,
} from "@apps/backend/modules/auth/utils/seller-review-sample.util";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";
import { TermsService } from "@apps/backend/modules/terms/terms.service";

const SAMPLE_PRODUCT_SELECT = {
  id: true,
  name: true,
  salePrice: true,
  images: true,
  productNumber: true,
} as const;

/**
 * 판매자 앱(픽케이크 사장님) 심사용 로그인 (I-48, SC-62).
 *
 * 애플 심사관은 소셜 로그인의 2단계 인증을 끝까지 하지 못해(손님 앱 3·4차 반려) 코드 하나로 들어오는 길을 둔다.
 * - 코드: 서버 환경값 `SELLER_REVIEW_LOGIN_CODE_SHA256`(코드의 SHA-256)과 비교한다. 값이 없으면 꺼짐.
 * - 계정: `SELLER_REVIEW_ACCOUNT_PHONE_MARKER`로 찾고, 없거나 탈퇴했으면 새로 만든다.
 * - 가게·상품: 손님 목록에서 빠지는 심사용 가게(`REVIEW_STORE_BUSINESS_NO`)와 예시 상품 2개를 없을 때만 만든다.
 * - 주문: 로그인할 때마다 예시 주문 8건(상태별)을 지우고 다시 만들어 심사관이 처리 버튼을 처음부터 눌러 볼 수 있게 한다.
 *   예시 주문은 판매자 알림·손님 알림톡 없이 바로 넣는다. 지난 알림도 함께 지운다.
 */
@Injectable()
export class AuthSellerReviewLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtUtil: JwtUtil,
    private readonly configService: ConfigService,
    private readonly termsService: TermsService,
  ) {}

  async sellerReviewLogin(dto: ReviewLoginRequestDto, now: Date = new Date()) {
    if (!this.isCodeMatch(dto.code)) {
      LoggerUtil.log("판매자 심사용 로그인 실패: 코드 불일치 또는 서버에 코드가 없음");
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.REVIEW_LOGIN_INVALID_CODE);
    }

    const sellerId = await this.prisma.$transaction(
      async (tx) => {
        const seller = await this.ensureSeller(tx, now);
        const store = await this.ensureStore(tx, seller.id);
        const products = await this.ensureProducts(tx, store.id);
        const consumer = await this.ensureSampleConsumer(tx);
        await this.resetSampleOrders(tx, {
          now,
          sellerId: seller.id,
          store,
          consumerId: consumer.id,
          products,
        });
        await this.recordTermsAgreements(tx, seller.id);
        return seller.id;
      },
      { maxWait: 5000, timeout: 20000 },
    );

    LoggerUtil.log(`판매자 심사용 로그인 성공 - sellerId: ${sellerId}`);
    const tokenPair = await this.jwtUtil.generateTokenPair({ sub: sellerId, aud: AUDIENCE.SELLER });
    return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
  }

  /** 입력 코드의 SHA-256을 환경값과 같은 길이로 비교(타이밍 공격 방지). 환경값이 없거나 형식이 다르면 항상 false */
  private isCodeMatch(code: string): boolean {
    const expected = this.configService
      .get<string>(SELLER_REVIEW_LOGIN_CODE_HASH_ENV)
      ?.trim()
      .toLowerCase();
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)) return false;
    const actual = createHash("sha256").update(code, "utf8").digest();
    return timingSafeEqual(actual, Buffer.from(expected, "hex"));
  }

  private async ensureSeller(tx: Prisma.TransactionClient, now: Date) {
    const existing = await tx.seller.findUnique({
      where: { phone: SELLER_REVIEW_ACCOUNT_PHONE_MARKER },
    });
    if (existing) {
      // 관리자가 막은 계정이면 들어오지 못한다(탈퇴한 계정은 phone이 바뀌어 여기서 찾히지 않는다)
      if (!existing.isActive) {
        throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
      }
      return tx.seller.update({ where: { id: existing.id }, data: { lastLoginAt: now } });
    }
    return tx.seller.create({
      data: {
        phone: SELLER_REVIEW_ACCOUNT_PHONE_MARKER,
        name: SELLER_REVIEW_SAMPLE.SELLER_NAME,
        nickname: SELLER_REVIEW_SAMPLE.SELLER_NAME,
        isPhoneVerified: true,
        isActive: true,
        sellerVerificationStatus: SellerVerificationStatus.BUSINESS_VERIFIED,
        lastLoginAt: now,
      },
    });
  }

  private async ensureStore(tx: Prisma.TransactionClient, sellerId: string) {
    const existing = await tx.store.findFirst({
      where: { sellerId, businessNo: REVIEW_STORE_BUSINESS_NO },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (existing) return existing;
    return tx.store.create({
      data: buildReviewStoreCreateData(sellerId),
      select: { id: true, name: true },
    });
  }

  private async ensureProducts(tx: Prisma.TransactionClient, storeId: string) {
    const existing = await tx.product.findMany({
      where: {
        storeId,
        productNumber: { in: REVIEW_SAMPLE_PRODUCTS.map((product) => product.productNumber) },
      },
      select: SAMPLE_PRODUCT_SELECT,
    });
    const products = [...existing];
    for (const sample of REVIEW_SAMPLE_PRODUCTS) {
      if (products.some((product) => product.productNumber === sample.productNumber)) continue;
      products.push(
        await tx.product.create({
          data: buildReviewProductCreateData(storeId, sample),
          select: SAMPLE_PRODUCT_SELECT,
        }),
      );
    }
    return products;
  }

  private async ensureSampleConsumer(tx: Prisma.TransactionClient) {
    return tx.consumer.upsert({
      where: { phone: SELLER_REVIEW_SAMPLE_CONSUMER_PHONE_MARKER },
      update: {},
      create: {
        phone: SELLER_REVIEW_SAMPLE_CONSUMER_PHONE_MARKER,
        name: SELLER_REVIEW_SAMPLE.CONSUMER_NAME,
        nickname: SELLER_REVIEW_SAMPLE.CONSUMER_NAME,
        isPhoneVerified: true,
        isActive: true,
      },
      select: { id: true },
    });
  }

  private async resetSampleOrders(
    tx: Prisma.TransactionClient,
    params: {
      now: Date;
      sellerId: string;
      store: { id: string; name: string };
      consumerId: string;
      products: Prisma.ProductGetPayload<{ select: typeof SAMPLE_PRODUCT_SELECT }>[];
    },
  ): Promise<void> {
    const { now, sellerId, store, consumerId, products } = params;

    // 지운 예시 주문을 가리키는 지난 알림도 함께 지운다(눌러도 열리지 않는 알림이 남지 않게)
    await tx.userNotification.deleteMany({
      where: { OR: [{ sellerId }, { consumerId }] },
    });
    await tx.order.deleteMany({ where: { storeId: store.id } });

    const orders = buildReviewSampleOrders({
      now,
      storeId: store.id,
      storeName: store.name,
      consumerId,
      products,
      randomSuffix: () => randomBytes(2).toString("hex").slice(0, 3).toUpperCase(),
    });
    for (const data of orders) {
      await tx.order.create({ data });
    }
  }

  /** 마이페이지 약관이 "미동의"로 보이지 않게 지금 판매자 약관에 동의한 것으로 둔다 */
  private async recordTermsAgreements(tx: Prisma.TransactionClient, sellerId: string) {
    const documents = await tx.termsDocument.findMany({
      where: {
        isActive: true,
        type: { in: [TermsType.SELLER_TERMS_OF_SERVICE, TermsType.SELLER_PRIVACY_POLICY] },
      },
      select: { id: true },
    });
    await this.termsService.recordSellerAgreementsInTransaction(
      tx,
      sellerId,
      documents.map((document) => document.id),
    );
  }
}
