import { describe, expect, it } from "vitest";
import {
  isCanonicalUploadUrl,
  isUploadKey,
  uploadUrlSpellings,
  uploadUrlToKey,
} from "@apps/backend/modules/upload/utils/upload-url.util";

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

describe("업로드 주소 꼴(11-17 검토: 꼴을 바꾼 남의 파일 주소)", () => {
  it("업로드 API가 지금 발급하는 꼴 그대로만 받는다", () => {
    expect(isCanonicalUploadUrl("https://cdn.picakes.com/uploads/1793_ab12cd34.jpg", opts)).toBe(
      true,
    );
    for (const bad of [
      "https://cdn.picakes.com/uploads/1793_ab12cd34.jpg?x",
      "https://cdn.picakes.com/uploads/1793_ab12cd34.jpg#x",
      "https://cdn.picakes.com/uploads/1793%5Fab12cd34.jpg",
      "https://picake-bucket.s3.ap-northeast-2.amazonaws.com/uploads/1793_ab12cd34.jpg",
      "https://cdn.picakes.com/backups/db.sql.gz",
      "https://cdn.picakes.com/uploads/a/b.jpg",
      "https://evil.example.com/uploads/x.jpg",
    ]) {
      expect(isCanonicalUploadUrl(bad, opts)).toBe(false);
    }
  });

  it("CloudFront가 없으면 S3 꼴이 발급 꼴", () => {
    const s3Only = { bucket: "picake-bucket", region: "ap-northeast-2" };
    expect(
      isCanonicalUploadUrl(
        "https://picake-bucket.s3.ap-northeast-2.amazonaws.com/uploads/x.jpg",
        s3Only,
      ),
    ).toBe(true);
  });

  it("업로드 키는 uploads/ 아래 한 조각만", () => {
    expect(isUploadKey("uploads/1_ab.jpg")).toBe(true);
    expect(isUploadKey("uploads/a/b.jpg")).toBe(false);
    expect(isUploadKey("backups/x")).toBe(false);
    expect(isUploadKey("uploads/..jpg")).toBe(false);
  });

  it("같은 파일을 가리키는 주소 꼴 셋(인코딩이 다르면 둘 다)", () => {
    expect(uploadUrlSpellings("uploads/x.jpg", opts)).toEqual([
      "https://cdn.picakes.com/uploads/x.jpg",
      "https://picake-bucket.s3.ap-northeast-2.amazonaws.com/uploads/x.jpg",
      "https://s3.ap-northeast-2.amazonaws.com/picake-bucket/uploads/x.jpg",
    ]);
    expect(uploadUrlSpellings("uploads/a b.jpg", { cloudfrontDomain: "cdn.picakes.com" })).toEqual([
      "https://cdn.picakes.com/uploads/a%20b.jpg",
      "https://cdn.picakes.com/uploads/a b.jpg",
    ]);
  });
});
