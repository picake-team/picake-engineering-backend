import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { QuoteRequestStoreInputDto } from "@apps/backend/modules/quote-request/dto/quote-request.dto";
import { CreateStoreEntryRequestDto } from "@apps/backend/modules/store-entry-request/dto/store-entry-request.dto";

/** 관리자 화면이 장소 링크를 그대로 링크로 보여 주므로 http·https만 받는다 */
describe("장소 링크(placeUrl)는 http·https만", () => {
  const errorsOf = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body))).filter((e) => e.property === "placeUrl");

  it("견적 요청의 물어볼 가게", async () => {
    const base = { kakaoPlaceId: "1", name: "가게" };
    expect(
      await errorsOf(QuoteRequestStoreInputDto, {
        ...base,
        placeUrl: "http://place.map.kakao.com/1",
      }),
    ).toHaveLength(0);
    expect(await errorsOf(QuoteRequestStoreInputDto, { ...base, placeUrl: "" })).toHaveLength(0);
    expect(await errorsOf(QuoteRequestStoreInputDto, base)).toHaveLength(0);
    expect(
      await errorsOf(QuoteRequestStoreInputDto, { ...base, placeUrl: "javascript:alert(1)" }),
    ).toHaveLength(1);
    expect(
      await errorsOf(QuoteRequestStoreInputDto, { ...base, placeUrl: "JaVaScRiPt:alert(1)" }),
    ).toHaveLength(1);
  });

  it("입점 요청", async () => {
    const base = { kakaoPlaceId: "1", placeName: "가게" };
    expect(
      await errorsOf(CreateStoreEntryRequestDto, {
        ...base,
        placeUrl: "https://place.map.kakao.com/1",
      }),
    ).toHaveLength(0);
    expect(
      await errorsOf(CreateStoreEntryRequestDto, { ...base, placeUrl: "javascript:alert(1)" }),
    ).toHaveLength(1);
  });
});
