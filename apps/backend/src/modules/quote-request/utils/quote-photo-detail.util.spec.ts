import { describe, expect, it } from "vitest";
import {
  buildPhotoDetailsForCreate,
  designIdsOf,
  normalizePhotoParts,
  readPhotoDetails,
} from "@apps/backend/modules/quote-request/utils/quote-photo-detail.util";

/** 참고 사진 정보(기획 I-112): 디자인 모음에서 왔는지, 무엇을 따를지 */
describe("참고 사진 정보", () => {
  it("따를 것: 전체가 있으면 전체만, 나머지는 겹치지 않게 모양·색·장식·글자 순서", () => {
    expect(normalizePhotoParts(["LETTERING", "SHAPE", "LETTERING"])).toEqual([
      "SHAPE",
      "LETTERING",
    ]);
    expect(normalizePhotoParts(["DECORATION", "ALL", "COLOR"])).toEqual(["ALL"]);
    expect(normalizePhotoParts(["COLOR", "DECORATION", "SHAPE", "LETTERING"])).toEqual([
      "SHAPE",
      "COLOR",
      "DECORATION",
      "LETTERING",
    ]);
    expect(normalizePhotoParts([])).toEqual(["ALL"]);
    expect(normalizePhotoParts(["WHATEVER", 3])).toEqual(["ALL"]);
  });

  it("저장할 때: 정보가 없으면 사진마다 손님 사진·전체, 개수가 다르면 null", () => {
    expect(buildPhotoDetailsForCreate(2, undefined)).toEqual({
      photoDetails: [
        { designId: null, parts: ["ALL"] },
        { designId: null, parts: ["ALL"] },
      ],
      designIds: [],
    });
    expect(buildPhotoDetailsForCreate(0, undefined)).toEqual({ photoDetails: [], designIds: [] });
    expect(buildPhotoDetailsForCreate(2, [{ designId: "a", parts: ["ALL"] }])).toBeNull();
    expect(buildPhotoDetailsForCreate(0, [{ designId: "a", parts: ["ALL"] }])).toBeNull();
  });

  it("저장할 때: 고른 디자인 ID는 겹치지 않게 사진 순서대로", () => {
    const res = buildPhotoDetailsForCreate(4, [
      { designId: "mini-ribbon", parts: ["COLOR", "SHAPE"] },
      { designId: null, parts: ["ALL"] },
      { parts: ["LETTERING"] },
      { designId: "mini-ribbon", parts: ["DECORATION", "ALL"] },
    ]);
    expect(res).toEqual({
      photoDetails: [
        { designId: "mini-ribbon", parts: ["SHAPE", "COLOR"] },
        { designId: null, parts: ["ALL"] },
        { designId: null, parts: ["LETTERING"] },
        { designId: "mini-ribbon", parts: ["ALL"] },
      ],
      designIds: ["mini-ribbon"],
    });
    expect(
      designIdsOf([
        { designId: "b", parts: ["ALL"] },
        { designId: "a", parts: ["ALL"] },
        { designId: "b", parts: ["ALL"] },
      ]),
    ).toEqual(["b", "a"]);
  });

  it("읽을 때: 이 칸이 생기기 전 요청([])·개수가 다른 값은 사진마다 손님 사진·전체", () => {
    const legacy = [
      { designId: null, parts: ["ALL"] },
      { designId: null, parts: ["ALL"] },
    ];
    expect(readPhotoDetails([], 2)).toEqual(legacy);
    expect(readPhotoDetails([{ designId: "a", parts: ["SHAPE"] }], 2)).toEqual(legacy);
    expect(readPhotoDetails(null, 2)).toEqual(legacy);
    expect(readPhotoDetails({ designId: "a" }, 1)).toEqual([{ designId: null, parts: ["ALL"] }]);
    expect(readPhotoDetails([], 0)).toEqual([]);
  });

  it("읽을 때: 칸 하나가 이상하면 그 칸만 손님 사진·전체로", () => {
    expect(
      readPhotoDetails(
        [
          { designId: "bento-heart", parts: ["LETTERING", "SHAPE"] },
          "이상한 값",
          { designId: "Not A Valid Id", parts: ["DECORATION"] },
          { designId: "ok-id", parts: "ALL" },
        ],
        4,
      ),
    ).toEqual([
      { designId: "bento-heart", parts: ["SHAPE", "LETTERING"] },
      { designId: null, parts: ["ALL"] },
      { designId: null, parts: ["DECORATION"] },
      { designId: "ok-id", parts: ["ALL"] },
    ]);
  });
});
