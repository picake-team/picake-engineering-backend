import { describe, expect, it, vi } from "vitest";

import type { SolapiService } from "@apps/backend/modules/solapi/solapi.service";
import {
  ConsumerOrderAlimtalkService,
  isAlimtalkRecipientPhone,
} from "@apps/backend/modules/solapi/services/consumer-order-alimtalk.service";

describe("isAlimtalkRecipientPhone", () => {
  it.each(["01012345678", "010-1234-5678", "010 1234 5678", "0111234567", "01912345678"])(
    "%s 는 휴대폰 번호다",
    (phone) => {
      expect(isAlimtalkRecipientPhone(phone)).toBe(true);
    },
  );

  it.each([
    "REVIEW_ACCOUNT",
    "REVIEW_SELLER_SAMPLE_CONSUMER",
    "withdrawn_cmabc123",
    "0212345678",
    "",
  ])("%s 는 휴대폰 번호가 아니다", (phone) => {
    expect(isAlimtalkRecipientPhone(phone)).toBe(false);
  });
});

describe("ConsumerOrderAlimtalkService.sendOrderAlimtalk", () => {
  function buildService() {
    const solapiService = {
      isAlimtalkEnabled: true,
      sendAlimtalk: vi.fn().mockResolvedValue(undefined),
    } as unknown as SolapiService;
    return { service: new ConsumerOrderAlimtalkService(solapiService), solapiService };
  }

  it("심사용 계정처럼 휴대폰 번호가 아니면 보내지 않는다", async () => {
    const { service, solapiService } = buildService();
    await service.sendOrderAlimtalk({
      to: "REVIEW_SELLER_SAMPLE_CONSUMER",
      templateId: "template",
      variables: {},
      orderId: "order-1",
    });
    expect(solapiService.sendAlimtalk).not.toHaveBeenCalled();
  });

  it("휴대폰 번호면 보낸다", async () => {
    const { service, solapiService } = buildService();
    await service.sendOrderAlimtalk({
      to: "01012345678",
      templateId: "template",
      variables: {},
      orderId: "order-1",
    });
    expect(solapiService.sendAlimtalk).toHaveBeenCalledWith(
      expect.objectContaining({ to: "01012345678", templateId: "template", disableSms: true }),
    );
  });
});
