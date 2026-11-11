import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { isProduction } from "@apps/backend/common/utils/environment.util";
import {
  buildNewSellerMessage,
  buildNewStoreEntryRequestMessage,
  buildNewStoreMessage,
  type NewSellerAlert,
  type NewStoreAlert,
  type NewStoreEntryRequestAlert,
  type OpsAlertContext,
} from "@apps/backend/modules/ops-alert/ops-alert-message.util";

/**
 * 운영자 실시간 알림(기획 I-56, 디스코드 【PICAKE】운영, 웹후크 `DISCORD_WEBHOOK_URL_OPS`).
 * 알림이 실패해도 사장님·손님의 일(가입·등록·요청)은 막지 않는다 — 이 서비스는 던지지 않는다.
 * 웹후크가 없으면(로컬·테스트) 보내지 않는다.
 */
@Injectable()
export class OpsAlertService {
  constructor(private readonly configService: ConfigService) {}

  notifyNewSeller(seller: NewSellerAlert): Promise<void> {
    return this.send("new-seller", (ctx) => buildNewSellerMessage(seller, ctx));
  }

  notifyNewStore(store: NewStoreAlert): Promise<void> {
    return this.send("new-store", (ctx) => buildNewStoreMessage(store, ctx));
  }

  notifyNewStoreEntryRequest(req: NewStoreEntryRequestAlert): Promise<void> {
    return this.send("new-store-entry-request", (ctx) =>
      buildNewStoreEntryRequestMessage(req, ctx),
    );
  }

  private async send(kind: string, build: (ctx: OpsAlertContext) => object): Promise<void> {
    const webhookUrl = this.configService.get<string>("DISCORD_WEBHOOK_URL_OPS");
    if (!webhookUrl) {
      LoggerUtil.log(`[OpsAlert] DISCORD_WEBHOOK_URL_OPS 미설정 — ${kind} 알림 생략`);
      return;
    }
    const nodeEnv = this.configService.get<string>("NODE_ENV");
    try {
      const message = build({
        adminDomain: this.configService.get<string>("PUBLIC_ADMIN_DOMAIN"),
        environmentLabel: isProduction(nodeEnv) ? null : (nodeEnv ?? "dev"),
      });
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
    } catch (e) {
      LoggerUtil.log(`[OpsAlert] ${kind} 알림 실패: ${e instanceof Error ? e.message : String(e)}`);
      SentryUtil.captureException(e, "warning", { module: "ops-alert", operation: kind });
    }
  }
}
