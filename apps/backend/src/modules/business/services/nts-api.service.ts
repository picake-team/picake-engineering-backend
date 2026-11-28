import { Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { BusinessValidationRequestDto } from "@apps/backend/modules/business/dto/business-request.dto";
import {
  B_STT_CD,
  BUSINESS_API_URLS,
  NTS_API_ERROR_MESSAGES,
  NTS_USER_MESSAGES,
  NTS_VALID_CD,
} from "@apps/backend/modules/business/constants/business.contants";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { SentryUtil } from "@apps/backend/common/utils/sentry.util";
import { isProduction } from "@apps/backend/common/utils/environment.util";

/**
 * 국세청 사업자 확인 결과(스토어 등록 알림에 함께 보낸다)
 * - verified: 국세청 정보와 맞고 계속사업자
 * - suspended: 맞지만 휴업 — 막지 않고 운영자가 사장님께 확인
 * - unverified: 국세청이 응답하지 않거나 키 문제 — 막지 않고 운영자가 직접 확인
 * - skipped: 상용이 아니라 조회하지 않음(로컬·테스트는 가짜 번호를 쓴다)
 */
export type BusinessCheckResult = "verified" | "suspended" | "unverified" | "skipped";

/**
 * 국세청 사업자등록정보 진위확인·상태조회 API 전용 서비스
 * 국세청 API 호출 및 응답 처리를 담당합니다.
 */
@Injectable()
export class NtsApiService {
  private readonly ntsApiUrl: string;
  private readonly dataGoKrApiKey?: string;
  private readonly axiosInstance: AxiosInstance;
  private readonly nodeEnv?: string;

  constructor(private readonly configService: ConfigService) {
    this.ntsApiUrl = BUSINESS_API_URLS.NTS;
    this.dataGoKrApiKey = this.configService.get<string>("DATA_GO_KR_API_KEY");
    this.nodeEnv = this.configService.get<string>("NODE_ENV");

    if (!this.dataGoKrApiKey) {
      LoggerUtil.log("DATA_GO_KR_API_KEY가 설정되지 않았습니다.");
      throw new Error("DATA_GO_KR_API_KEY가 설정되지 않았습니다.");
    }

    // axios 인스턴스 생성 (타임아웃 설정 포함)
    this.axiosInstance = axios.create({
      baseURL: this.ntsApiUrl,
      timeout: 5000, // 5초 — 스토어 만들기를 오래 붙잡지 않게(두 번까지 시도)
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * 재시도 로직이 포함된 API 호출
   * @param apiCall API 호출 함수
   * @param maxRetries 최대 재시도 횟수
   * @returns API 응답
   */
  private async callWithRetry<T>(apiCall: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error: any) {
        lastError = error;

        // 재시도 가능한 에러인지 확인 (네트워크 에러, 타임아웃, 5xx 에러)
        const isRetryable =
          error.code === "ECONNABORTED" || // 타임아웃
          error.code === "ETIMEDOUT" || // 연결 타임아웃
          error.code === "ECONNRESET" || // 연결 리셋
          error.code === "ENOTFOUND" || // DNS 에러
          (error.response?.status >= 500 && error.response?.status < 600); // 5xx 서버 에러

        if (!isRetryable || attempt === maxRetries) {
          LoggerUtil.log(
            `국세청 API 호출 최종 실패 - attempt: ${attempt}/${maxRetries}, error: ${error.message || String(error)}`,
          );
          throw error;
        }

        // 지수 백오프: 1초, 2초, 4초
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        LoggerUtil.log(
          `국세청 API 호출 실패 (${attempt}/${maxRetries}), ${delayMs}ms 후 재시도...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    LoggerUtil.log(`국세청 API 호출 모든 재시도 실패 - maxRetries: ${maxRetries}`);
    throw lastError;
  }

  /**
   * 사업자등록번호 진위확인(기획 P-40, 2026-11-28 다시 켬 — 상용에서만)
   *
   * 국세청 진위확인에 사업자등록번호·개업일자·대표자명 세 칸만 보낸다. 상호·업태·종목까지 보내면
   * 국세청 기록과 글자 그대로 맞아야 해서(띄어쓰기·"(주)" 등) 진짜 사장님도 떨어지기 쉬웠다
   * (2026-08-12에 꺼 둔 까닭으로 보임). 세 칸이 맞지 않거나 폐업이면 막고, 휴업은 막지 않는다.
   * 국세청이 응답하지 않거나 키가 막히면 막지 않고 "unverified"를 돌려 운영자가 직접 확인한다.
   */
  async verifyBusinessRegistration(
    validationDto: BusinessValidationRequestDto,
  ): Promise<BusinessCheckResult> {
    if (!isProduction(this.nodeEnv)) {
      LoggerUtil.log(`[${this.nodeEnv}] 사업자등록번호 진위확인 건너뜀(상용에서만 조회)`);
      return "skipped";
    }

    const payload = {
      b_no: validationDto.b_no.replace(/[-\s]/g, ""),
      start_dt: validationDto.start_dt,
      p_nm: validationDto.p_nm,
    };

    let row: NtsValidateRow | undefined;
    try {
      const response = await this.callWithRetry(
        () =>
          this.axiosInstance.post<NtsValidateResponse>(
            `${this.ntsApiUrl}/nts-businessman/v1/validate?serviceKey=${this.dataGoKrApiKey}`,
            { businesses: [payload] },
          ),
        2,
      );
      row = response.data?.data?.[0];
      if (!row) throw new Error(NTS_API_ERROR_MESSAGES.DATA_NOT_FOUND);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      LoggerUtil.log(`[NTS_API] 사업자등록번호 진위확인을 못 함(막지 않음): ${message}`);
      SentryUtil.captureException(error, "warning", {
        module: "business",
        operation: "nts-verify-business-registration",
      });
      return "unverified";
    }

    if (row.valid !== NTS_VALID_CD.MATCH) {
      LoggerUtil.log(`[NTS_API] 국세청 정보와 맞지 않음: ${row.valid_msg ?? row.valid}`);
      throw new BadRequestException(NTS_USER_MESSAGES.MISMATCH);
    }
    const statusCode = row.status?.b_stt_cd;
    if (statusCode === B_STT_CD.CLOSED) {
      LoggerUtil.log("[NTS_API] 폐업한 사업자등록번호");
      throw new BadRequestException(NTS_USER_MESSAGES.CLOSED);
    }
    if (statusCode === B_STT_CD.INACTIVE) {
      LoggerUtil.log("[NTS_API] 휴업 중인 사업자등록번호(막지 않음)");
      return "suspended";
    }
    return "verified";
  }
}

/** 국세청 진위확인 응답(필요한 칸만). valid "01"이면 status가 함께 온다 */
interface NtsValidateRow {
  b_no?: string;
  valid?: string;
  valid_msg?: string;
  status?: { b_stt?: string; b_stt_cd?: string };
}
interface NtsValidateResponse {
  status_code?: string;
  data?: NtsValidateRow[];
}
