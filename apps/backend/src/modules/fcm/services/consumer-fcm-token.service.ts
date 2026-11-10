import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";

/** 동시 등록 충돌(P2002) 때 다시 해 보는 최대 횟수(처음 포함) */
const SYNC_MAX_ATTEMPTS = 3;

/**
 * 구매자 FCM 토큰 영속성 계층.
 * - 동기화: user + deviceId 단위 upsert (같은 디바이스면 token 갱신)
 * - 동기화(빈 token): user + deviceId 단위 삭제 (로그아웃 시)
 * - 조회: 특정 소비자의 유효 토큰 목록
 */
@Injectable()
export class ConsumerFcmTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private static normalizeToken(token: string): string {
    return token.trim();
  }

  private static normalizeDeviceId(deviceId: string): string {
    return deviceId.trim();
  }

  async syncToken(consumerId: string, deviceId: string, token: string): Promise<void> {
    const normalizedDeviceId = ConsumerFcmTokenService.normalizeDeviceId(deviceId);
    const normalizedToken = ConsumerFcmTokenService.normalizeToken(token);
    if (!normalizedDeviceId) {
      return;
    }

    if (!normalizedToken) {
      await this.prisma.consumerFcmToken.deleteMany({
        where: { consumerId, deviceId: normalizedDeviceId },
      });
      return;
    }

    // 앱이 같은 토큰을 거의 동시에 두 번 보내면 늦은 쪽이 유니크 충돌(P2002)로 실패한다.
    // 그때는 먼저 들어간 줄이 있으니 다시 하면 그 줄을 고친다 (판매자 토큰과 같은 규칙).
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.saveToken(consumerId, normalizedDeviceId, normalizedToken);
        return;
      } catch (error) {
        if (attempt < SYNC_MAX_ATTEMPTS && (error as { code?: string })?.code === "P2002") continue;
        throw error;
      }
    }
  }

  private async saveToken(consumerId: string, deviceId: string, token: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 동일 token이 다른 사용자/디바이스에 귀속된 경우 제거 (토큰 재발급/계정 전환 시나리오)
      await tx.consumerFcmToken.deleteMany({
        where: {
          token,
          NOT: { consumerId, deviceId },
        },
      });

      await tx.consumerFcmToken.upsert({
        where: { consumerId_deviceId: { consumerId, deviceId } },
        create: { consumerId, deviceId, token },
        update: { token, updatedAt: new Date() },
      });
    });
  }

  /**
   * 해당 소비자의 모든 FCM 토큰을 반환합니다.
   */
  async getTokensByConsumerId(consumerId: string): Promise<string[]> {
    const rows = await this.prisma.consumerFcmToken.findMany({
      where: { consumerId },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  /**
   * 만료·무효 토큰을 일괄 삭제합니다 (FCM 발송 실패 후 정리).
   */
  async removeInvalidTokens(tokens: string[]): Promise<void> {
    const uniqueTokens = Array.from(
      new Set(tokens.map((token) => ConsumerFcmTokenService.normalizeToken(token)).filter(Boolean)),
    );
    if (uniqueTokens.length === 0) return;

    await this.prisma.consumerFcmToken.deleteMany({
      where: { token: { in: uniqueTokens } },
    });
    LoggerUtil.log(`[ConsumerFcmTokenService] 무효 토큰 ${uniqueTokens.length}개 삭제`);
  }
}
