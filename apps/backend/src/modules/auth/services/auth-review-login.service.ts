import { createHash, timingSafeEqual } from "crypto";
import { ConfigService } from "@nestjs/config";
import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import {
  AUDIENCE,
  AUTH_ERROR_MESSAGES,
  CONSUMER_REVIEW_LOGIN_CODE_HASH_ENV,
  REVIEW_LOGIN_ACCOUNT_PHONE_MARKER,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { ReviewLoginRequestDto } from "@apps/backend/modules/auth/dto/auth-review-login.dto";

/**
 * 앱스토어/플레이스토어 심사(리뷰) 대응 전용 로그인.
 *
 * 코드는 서버 환경값 `CONSUMER_REVIEW_LOGIN_CODE_SHA256`(코드의 SHA-256, GitHub 비밀값)과 비교합니다.
 * 값이 없으면 꺼집니다(항상 코드 오류). 판매자 심사용 로그인과 같은 방식입니다.
 * 심사용 계정도 미리 시드해 둘 필요 없이, 최초 호출 시 `REVIEW_LOGIN_ACCOUNT_PHONE_MARKER`로 자동 upsert됩니다
 * (실제 휴대폰 번호 형식이 아니라서 실사용자 계정과 겹치지 않음).
 */
@Injectable()
export class AuthReviewLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtUtil: JwtUtil,
    private readonly configService: ConfigService,
  ) {}

  async consumerReviewLogin(dto: ReviewLoginRequestDto) {
    if (!this.isCodeMatch(dto.code)) {
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.REVIEW_LOGIN_INVALID_CODE);
    }

    const consumer = await this.prisma.consumer.upsert({
      where: { phone: REVIEW_LOGIN_ACCOUNT_PHONE_MARKER },
      update: {},
      create: {
        phone: REVIEW_LOGIN_ACCOUNT_PHONE_MARKER,
        nickname: "심사용 계정",
        isPhoneVerified: true,
        isActive: true,
      },
    });

    if (!consumer.isActive) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }

    return await this.prisma.$transaction(async (tx) => {
      const tokenPair = await this.jwtUtil.generateTokenPair({
        sub: consumer.id,
        aud: AUDIENCE.CONSUMER,
      });
      await tx.consumer.update({
        where: { id: consumer.id },
        data: { lastLoginAt: new Date() },
      });
      return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
    });
  }

  /** 입력 코드의 SHA-256을 환경값과 같은 길이로 비교(타이밍 공격 방지). 환경값이 없거나 형식이 다르면 항상 false */
  private isCodeMatch(code: string): boolean {
    const expected = this.configService
      .get<string>(CONSUMER_REVIEW_LOGIN_CODE_HASH_ENV)
      ?.trim()
      .toLowerCase();
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)) return false;
    const actual = createHash("sha256").update(code, "utf8").digest();
    return timingSafeEqual(actual, Buffer.from(expected, "hex"));
  }
}
