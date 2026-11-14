import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateQuoteRequestDto,
  QuoteRequestStoreInputDto,
} from "@apps/backend/modules/quote-request/dto/quote-request.dto";
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

/** 참고 사진 정보(기획 I-112): 디자인 ID 모양·따를 것·장수 */
describe("견적 요청서 photoDetails", () => {
  const base = {
    pickupDate: "2026-12-24",
    size: "NO1",
    quantity: 1,
    budgetMin: 30000,
    photoUrls: ["https://cdn.example.com/a.jpg"],
  };
  const errorsOf = async (photoDetails: unknown) =>
    (
      await validate(plainToInstance(CreateQuoteRequestDto, { ...base, photoDetails }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).filter((e) => e.property === "photoDetails");

  it("디자인 모음 사진·손님 사진(null·없음)을 받는다", async () => {
    expect(await errorsOf(undefined)).toHaveLength(0);
    expect(
      await errorsOf([{ designId: "bento-heart-lettering", parts: ["DECORATION"] }]),
    ).toHaveLength(0);
    expect(await errorsOf([{ designId: null, parts: ["ALL"] }])).toHaveLength(0);
    expect(
      await errorsOf([{ parts: ["SHAPE", "COLOR", "DECORATION", "LETTERING", "ALL"] }]),
    ).toHaveLength(0);
    expect(await errorsOf([{ designId: "a1", parts: ["SHAPE"] }])).toHaveLength(0);
  });

  it("디자인 ID 모양이 틀리거나 80자를 넘으면 막는다", async () => {
    for (const designId of [
      "Bento",
      "bento_heart",
      "-bento",
      "bento-",
      "bento--heart",
      "",
      "케이크",
      "a".repeat(81),
    ]) {
      expect(await errorsOf([{ designId, parts: ["ALL"] }])).toHaveLength(1);
    }
    expect(await errorsOf([{ designId: "a".repeat(80), parts: ["ALL"] }])).toHaveLength(0);
  });

  it("따를 것은 1~5개, 다섯 값 중에서", async () => {
    expect(await errorsOf([{ designId: null, parts: [] }])).toHaveLength(1);
    expect(await errorsOf([{ designId: null }])).toHaveLength(1);
    expect(await errorsOf([{ designId: null, parts: ["TASTE"] }])).toHaveLength(1);
    expect(await errorsOf([{ designId: null, parts: "ALL" }])).toHaveLength(1);
    expect(
      await errorsOf([{ parts: ["ALL", "SHAPE", "COLOR", "DECORATION", "LETTERING", "ALL"] }]),
    ).toHaveLength(1);
  });

  it("4장 이상이거나 모르는 칸이 있으면 막는다", async () => {
    const one = { designId: null, parts: ["ALL"] };
    expect(await errorsOf([one, one, one, one])).toHaveLength(1);
    expect(await errorsOf([{ ...one, url: "https://x" }])).toHaveLength(1);
    expect(await errorsOf("ALL")).toHaveLength(1);
  });

  it("들어온 곳에 디자인 모음(DESIGN)을 받는다", async () => {
    const errors = await validate(
      plainToInstance(CreateQuoteRequestDto, { ...base, entry: "DESIGN" }),
    );
    expect(errors.filter((e) => e.property === "entry")).toHaveLength(0);
  });
});
