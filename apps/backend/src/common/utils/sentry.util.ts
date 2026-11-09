import * as Sentry from "@sentry/nestjs";
import { ConfigService } from "@nestjs/config";
import { LoggerUtil } from "./logger.util";
import { SensitiveDataUtil } from "./sensitive-data.util";
import { isStagingOrProduction } from "@apps/backend/common/utils/environment.util";

/**
 * Sentry 유틸리티
 * 에러 로깅 및 모니터링을 위한 공통 유틸리티
 */
export class SentryUtil {
  private static nodeEnv: string | null = null;

  /** captureExceptionThrottled: key별 마지막 전송 시각(ms) */
  private static readonly lastSentAt = new Map<string, number>();

  /**
   * SentryUtil 초기화
   * ConfigService를 설정하여 환경 변수를 사용할 수 있도록 합니다.
   * @param configService ConfigService 인스턴스
   */
  static initialize(configService: ConfigService): void {
    const nodeEnv = configService.get<string>("NODE_ENV", "development");
    if (!nodeEnv) {
      throw new Error("NODE_ENV 환경 변수가 설정되어 있지 않습니다.");
    }
    this.nodeEnv = nodeEnv;
  }

  /**
   * Sentry 전송이 활성화되어 있는지 확인
   */
  static enabled(): boolean {
    if (!this.nodeEnv) {
      return true;
    }
    // 검증(staging)과 상용(production) 환경에서만 Sentry 전송을 수행합니다.
    return isStagingOrProduction(this.nodeEnv);
  }

  /**
   * 에러를 Sentry로 전송해야 하는지 판단
   * @param statusCode HTTP 상태 코드
   */
  static shouldSendToSentry(statusCode: number): boolean {
    // 점검 모드(503)는 의도된 응답이므로 Sentry 전송 제외
    if (statusCode === 503) {
      return false;
    }

    // 5xx 에러는 항상 전송
    if (statusCode >= 500) {
      return true;
    }

    // 그 외 4xx 에러는 전송하지 않음 (노이즈 방지)
    return false;
  }

  /**
   * 에러 레벨 결정
   * @param statusCode HTTP 상태 코드
   */
  static getErrorLevel(statusCode: number): Sentry.SeverityLevel {
    // HTTP 상태 코드 기반 레벨 결정
    let level: Sentry.SeverityLevel = "error";
    if (statusCode >= 500) {
      level = "error";
    } else if (statusCode >= 400) {
      level = "warning";
    } else {
      level = "info";
    }
    return level;
  }

  /**
   * 예외를 Sentry로 전송
   * @param exception 예외 객체
   * @param level 에러 레벨
   * @param tags Sentry 태그 (예: { responseId: "xxx" })
   * @param extra Sentry Extra 컨텍스트 (구조화된 디버그 정보)
   */
  static captureException(
    exception: unknown,
    level: Sentry.SeverityLevel,
    tags?: Record<string, string>,
    extra?: Record<string, unknown>,
  ): void {
    if (!this.enabled()) {
      return;
    }
    try {
      // 예외 전송
      Sentry.captureException(exception, {
        level,
        tags,
        extra,
      });
    } catch (error) {
      // Sentry 전송 실패 시 로그만 기록
      LoggerUtil.log(
        `Sentry 예외 전송 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 같은 원인이 짧은 시간에 반복될 때(예: DB 장애 중 모든 로그인 확인 실패) Sentry 무료 한도를 다 쓰지 않도록
   * key마다 intervalMs에 한 번만 보낸다.
   * @returns 이번에 보냈으면 true
   */
  static captureExceptionThrottled(
    key: string,
    intervalMs: number,
    exception: unknown,
    level: Sentry.SeverityLevel,
    tags?: Record<string, string>,
    extra?: Record<string, unknown>,
  ): boolean {
    const now = Date.now();
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < intervalMs) {
      return false;
    }
    this.lastSentAt.set(key, now);
    this.captureException(exception, level, tags, extra);
    return true;
  }

  /**
   * 아직 보내지 못한 이벤트를 마저 보낸다. `process.exit` 직전에 부른다(바로 끝내면 전송 전에 꺼진다).
   * @param timeoutMs 최대 대기 시간
   */
  static async flush(timeoutMs = 2000): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    try {
      await Sentry.flush(timeoutMs);
    } catch (error) {
      LoggerUtil.log(
        `Sentry flush 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Sentry로 보내는 문장에서 이메일·휴대폰 번호·Bearer 토큰을 가린다.
   * (예: Prisma 입력 오류 메시지에는 넣으려던 값이 그대로 들어간다)
   */
  static scrubText(text: string): string {
    return text
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ****")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (email) =>
        SensitiveDataUtil.maskEmail(email),
      )
      .replace(/\b(01[016789])-?\d{3,4}-?(\d{4})\b/g, "$1-****-$2");
  }

  /** 객체·배열 안의 모든 문자열에 scrubText를 적용한다 */
  private static scrubValue(value: unknown, depth = 0): unknown {
    if (typeof value === "string") {
      return this.scrubText(value);
    }
    if (depth > 8 || value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.scrubValue(item, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.scrubValue(item, depth + 1)]),
    );
  }

  /**
   * Sentry.init의 beforeSend: 보내기 전에 예외 메시지·메시지·extra·breadcrumb의 개인정보를 가린다.
   * extra는 키 이름(password, phone, email 등)으로도 가린다.
   */
  static scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
    for (const exception of event.exception?.values ?? []) {
      if (exception.value) {
        exception.value = this.scrubText(exception.value);
      }
    }
    if (event.message) {
      event.message = this.scrubText(event.message);
    }
    if (event.extra) {
      event.extra = this.scrubValue(SensitiveDataUtil.maskSensitiveFields(event.extra)) as Record<
        string,
        unknown
      >;
    }
    for (const breadcrumb of event.breadcrumbs ?? []) {
      if (breadcrumb.message) {
        breadcrumb.message = this.scrubText(breadcrumb.message);
      }
    }
    return event;
  }

  /**
   * 메시지를 Sentry로 전송
   * @param message 전송할 메시지
   * @param level 메시지 레벨
   * @param tags Sentry 태그
   */
  static captureMessage(
    message: string,
    level: Sentry.SeverityLevel = "info",
    tags?: Record<string, string>,
  ): void {
    if (!this.enabled()) {
      return;
    }
    try {
      Sentry.captureMessage(message, {
        level,
        tags,
      });
    } catch (error) {
      LoggerUtil.log(
        `Sentry 메시지 전송 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
