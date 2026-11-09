import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { UploadService } from "@apps/backend/modules/upload/upload.service";

/**
 * 손님이 탈퇴하면 견적 요청을 지운다(기획 I-46).
 * 주문과 달리 견적 요청은 계약이 아니라 법정 보관 의무가 없고, 개인정보 처리방침은 "회원 탈퇴 시까지 보유"다.
 * 탈퇴는 계정을 지우지 않고 익명화하므로(주문 보관 때문에) 연결된 견적 요청이 자동으로 지워지지 않는다.
 * 요청(물어볼 가게 포함)을 지운 뒤 참고 사진 파일도 지운다. 사진 지우기에 실패해도 탈퇴는 계속한다.
 */
@Injectable()
export class QuoteRequestCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async deleteAllForConsumer(consumerId: string): Promise<{ requests: number; photos: number }> {
    const rows = await this.prisma.quoteRequest.findMany({
      where: { consumerId },
      select: { photoUrls: true },
    });
    if (rows.length === 0) return { requests: 0, photos: 0 };

    const { count } = await this.prisma.quoteRequest.deleteMany({ where: { consumerId } });
    const urls = rows.flatMap((r) => r.photoUrls);
    let photos = 0;
    try {
      photos = urls.length ? await this.uploadService.deleteFilesByUrl(urls) : 0;
    } catch (e) {
      SentryUtil.captureException(e, "warning", {
        module: "quote-request",
        operation: "withdraw-cleanup",
      });
    }
    LoggerUtil.log(
      `[QuoteRequestCleanup] 탈퇴로 견적 요청 ${count}건·사진 ${photos}/${urls.length}장 삭제`,
    );
    return { requests: count, photos };
  }
}
