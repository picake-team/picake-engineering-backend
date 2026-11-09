import { describe, expect, it } from "vitest";
import { uploadUrlToKey } from "@apps/backend/modules/upload/utils/upload-url.util";

const opts = {
  cloudfrontDomain: "cdn.picakes.com",
  bucket: "picake-bucket",
  region: "ap-northeast-2",
};

describe("uploadUrlToKey (지울 파일의 S3 키)", () => {
  it("CloudFront·S3 주소에서 키를 되돌린다(조각마다 디코딩)", () => {
    expect(uploadUrlToKey("https://cdn.picakes.com/uploads/1793_ab%20c.jpg", opts)).toBe(
      "uploads/1793_ab c.jpg",
    );
    expect(
      uploadUrlToKey("https://picake-bucket.s3.ap-northeast-2.amazonaws.com/uploads/x.jpg", opts),
    ).toBe("uploads/x.jpg");
    expect(
      uploadUrlToKey("https://s3.ap-northeast-2.amazonaws.com/picake-bucket/uploads/y.jpg", opts),
    ).toBe("uploads/y.jpg");
  });

  it("다른 곳의 주소·경로 이동은 지우지 않는다", () => {
    expect(uploadUrlToKey("https://evil.example.com/uploads/x.jpg", opts)).toBeNull();
    expect(uploadUrlToKey("https://cdn.picakes.com/../secret", opts)).toBeNull();
    expect(uploadUrlToKey("https://cdn.picakes.com/", opts)).toBeNull();
  });
});
