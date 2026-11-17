import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";

const s3Constructed: unknown[] = [];

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: unknown) {
      s3Constructed.push(config);
    }
    send = vi.fn();
  },
  PutObjectCommand: class {},
  DeleteObjectCommand: class {},
}));

import { UploadCreateService } from "@apps/backend/modules/upload/services/upload-create.service";

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const base = { AWS_REGION: "ap-northeast-2", S3_BUCKET: "picake-uploads-staging-apne2" };

describe("UploadCreateService 자격 증명(서버는 키 없이 EC2 역할)", () => {
  beforeEach(() => {
    s3Constructed.length = 0;
  });

  it("키가 없으면 credentials를 넘기지 않아 SDK 기본 체인(EC2 인스턴스 역할)을 쓴다", () => {
    new UploadCreateService(config(base));
    expect(s3Constructed).toHaveLength(1);
    expect(s3Constructed[0]).toEqual({ region: "ap-northeast-2" });
  });

  it("키가 둘 다 있으면(로컬 개발·테스트) 그 키를 쓴다", () => {
    new UploadCreateService(
      config({ ...base, AWS_ACCESS_KEY_ID: "AKIATEST", AWS_SECRET_ACCESS_KEY: "secret" }),
    );
    expect(s3Constructed[0]).toEqual({
      region: "ap-northeast-2",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
    });
  });

  it("키가 하나만 있으면 설정 실수로 보고 멈춘다", () => {
    expect(
      () => new UploadCreateService(config({ ...base, AWS_ACCESS_KEY_ID: "AKIATEST" })),
    ).toThrow(/둘 다/);
    expect(
      () => new UploadCreateService(config({ ...base, AWS_SECRET_ACCESS_KEY: "secret" })),
    ).toThrow(/둘 다/);
    expect(s3Constructed).toHaveLength(0);
  });

  it("버킷·리전이 없으면 예전처럼 멈춘다", () => {
    expect(() => new UploadCreateService(config({ AWS_REGION: "ap-northeast-2" }))).toThrow(
      /S3_BUCKET/,
    );
  });
});
