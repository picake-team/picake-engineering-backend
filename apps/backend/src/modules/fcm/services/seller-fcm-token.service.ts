import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";

/**
 * 판매자 FCM 토큰 영속성 계층 (판매자 앱, 기획 I-48).
 * 규칙은 구매자(`ConsumerFcmTokenService`)와 같습니다.
 * - 동기화: seller + deviceId 단위 upsert (같은 디바이스면 token 갱신)
 * - 동기화(빈 token): seller + deviceId 단위 삭제 (로그아웃 시)
 * - 조회: 특정 판매자의 토큰 목록
 */
@Injectable()
export class SellerFcmTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async syncToken(sellerId: string, deviceId: string, token: string): Promise<void> {
    const normalizedDeviceId = deviceId.trim();
    const normalizedToken = token.trim();
    if (!normalizedDeviceId) {
      return;
    }

    if (!normalizedToken) {
      await this.prisma.sellerFcmToken.deleteMany({
        where: { sellerId, deviceId: normalizedDeviceId },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // 같은 토큰이 다른 판매자·디바이스에 남아 있으면 지움 (토큰 재발급, 한 휴대폰에서 계정을 바꾼 경우)
      await tx.sellerFcmToken.deleteMany({
        where: {
          token: normalizedToken,
          NOT: { sellerId, deviceId: normalizedDeviceId },
        },
      });

      await tx.sellerFcmToken.upsert({
        where: { sellerId_deviceId: { sellerId, deviceId: normalizedDeviceId } },
        create: { sellerId, deviceId: normalizedDeviceId, token: normalizedToken },
        update: { token: normalizedToken, updatedAt: new Date() },
      });
    });
  }

  async getTokensBySellerId(sellerId: string): Promise<string[]> {
    const rows = await this.prisma.sellerFcmToken.findMany({
      where: { sellerId },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  /** 판매자의 토큰을 모두 지웁니다 (탈퇴 시). */
  async removeAllBySellerId(sellerId: string): Promise<void> {
    await this.prisma.sellerFcmToken.deleteMany({ where: { sellerId } });
  }

  /** 만료·무효 토큰을 일괄 삭제합니다 (FCM 발송 실패 후 정리). */
  async removeInvalidTokens(tokens: string[]): Promise<void> {
    const uniqueTokens = Array.from(new Set(tokens.map((t) => t.trim()).filter(Boolean)));
    if (uniqueTokens.length === 0) return;

    await this.prisma.sellerFcmToken.deleteMany({
      where: { token: { in: uniqueTokens } },
    });
    LoggerUtil.log(`[SellerFcmTokenService] 무효 토큰 ${uniqueTokens.length}개 삭제`);
  }
}
