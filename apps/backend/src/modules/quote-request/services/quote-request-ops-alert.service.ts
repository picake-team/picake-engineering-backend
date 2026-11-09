import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { isProduction } from "@apps/backend/common/utils/environment.util";
import type { QuoteRequestRow } from "@apps/backend/modules/quote-request/utils/quote-request-mapper.util";
import { buildNewQuoteRequestDiscordMessage } from "@apps/backend/modules/quote-request/utils/quote-request-ops-message.util";

/**
 * 운영자 알림(디스코드 【PICAKE】운영 채널, 웹후크 `DISCORD_WEBHOOK_URL_OPS`).
 * 알림이 실패해도 손님의 요청 보내기는 막지 않는다. 웹후크가 없으면(로컬·테스트) 보내지 않는다.
 */
@Injectable()
export class QuoteRequestOpsAlertService {
  constructor(private readonly configService: ConfigService) {}

  async notifyNewRequest(row: QuoteRequestRow): Promise<void> {
    const webhookUrl = this.configService.get<string>("DISCORD_WEBHOOK_URL_OPS");
    if (!webhookUrl) {
      LoggerUtil.log(
        `[QuoteRequestOpsAlert] DISCORD_WEBHOOK_URL_OPS 미설정 — 새 요청 알림 생략 request=${row.id}`,
      );
      return;
    }

    const nodeEnv = this.configService.get<string>("NODE_ENV");
    const message = buildNewQuoteRequestDiscordMessage(row, {
      adminDomain: this.configService.get<string>("PUBLIC_ADMIN_DOMAIN"),
      environmentLabel: isProduction(nodeEnv) ? null : (nodeEnv ?? "dev"),
    });

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error(`Discord webhook HTTP ${res.status}`);
      }
    } catch (e) {
      LoggerUtil.log(
        `[QuoteRequestOpsAlert] 새 요청 알림 실패 request=${row.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
      SentryUtil.captureException(e, "warning", {
        module: "quote-request",
        operation: "ops-alert-new-request",
      });
    }
  }
}
