import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NTS_USER_MESSAGES,
  NTS_VALID_CD,
} from "@apps/backend/modules/business/constants/business.contants";
import type { BusinessValidationRequestDto } from "@apps/backend/modules/business/dto/business-request.dto";

import { NtsApiService } from "./nts-api.service";

vi.mock("axios", () => ({ default: { create: vi.fn() } }));

const DTO = {
  b_no: "123-45-67890",
  start_dt: "20200101",
  p_nm: "홍길동",
  b_nm: "달콤 케이크(주)",
  b_sector: "제조업",
  b_type: "제과점",
} as BusinessValidationRequestDto;

const ok = (row: object) => ({ data: { status_code: "OK", data: [row] } });

describe("NtsApiService 사업자등록번호 진위확인(기획 P-40, 상용에서만)", () => {
  const post = vi.fn();

  const build = (nodeEnv: string) => {
    vi.mocked(axios.create).mockReturnValue({ post } as never);
    const config = {
      get: (key: string) => ({ DATA_GO_KR_API_KEY: "test-key", NODE_ENV: nodeEnv })[key],
    } as unknown as ConfigService;
    return new NtsApiService(config);
  };

  beforeEach(() => {
    post.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("상용이 아니면 국세청을 부르지 않는다(로컬·테스트는 가짜 번호)", async () => {
    for (const env of ["staging", "development", "test"]) {
      await expect(build(env).verifyBusinessRegistration(DTO)).resolves.toBe("skipped");
    }
    expect(post).not.toHaveBeenCalled();
  });

  it("번호·개업일·대표자명 세 칸만 보낸다(상호·업태·종목은 글자가 달라 떨어지기 쉬워 빼고, 번호는 하이픈 없이)", async () => {
    post.mockResolvedValue(ok({ valid: NTS_VALID_CD.MATCH, status: { b_stt_cd: "01" } }));
    await expect(build("production").verifyBusinessRegistration(DTO)).resolves.toBe("verified");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toEqual({
      businesses: [{ b_no: "1234567890", start_dt: "20200101", p_nm: "홍길동" }],
    });
  });

  it("국세청 정보와 맞지 않으면(valid 02) 사장님이 고칠 수 있는 글로 막는다", async () => {
    post.mockResolvedValue(ok({ valid: NTS_VALID_CD.NO_MATCH, valid_msg: "확인할 수 없습니다." }));
    const p = build("production").verifyBusinessRegistration(DTO);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(NTS_USER_MESSAGES.MISMATCH);
  });

  it("폐업이면 막는다", async () => {
    post.mockResolvedValue(ok({ valid: NTS_VALID_CD.MATCH, status: { b_stt_cd: "03" } }));
    await expect(build("production").verifyBusinessRegistration(DTO)).rejects.toThrow(
      NTS_USER_MESSAGES.CLOSED,
    );
  });

  it("휴업이면 막지 않고 suspended(운영자 알림에 싣는다)", async () => {
    post.mockResolvedValue(ok({ valid: NTS_VALID_CD.MATCH, status: { b_stt_cd: "02" } }));
    await expect(build("production").verifyBusinessRegistration(DTO)).resolves.toBe("suspended");
  });

  it("키가 막히는 등 국세청 오류면 막지 않고 unverified", async () => {
    post.mockRejectedValue(Object.assign(new Error("401"), { response: { status: 401 } }));
    await expect(build("production").verifyBusinessRegistration(DTO)).resolves.toBe("unverified");
    expect(post).toHaveBeenCalledTimes(1); // 다시 해도 같은 오류는 바로 포기
  });

  it("국세청이 응답하지 않으면 두 번까지 해 보고 막지 않는다", async () => {
    vi.useFakeTimers();
    post.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    const p = build("production").verifyBusinessRegistration(DTO);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("unverified");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("응답에 결과 줄이 없으면 막지 않고 unverified", async () => {
    post.mockResolvedValue({ data: { status_code: "OK", data: [] } });
    await expect(build("production").verifyBusinessRegistration(DTO)).resolves.toBe("unverified");
  });
});
