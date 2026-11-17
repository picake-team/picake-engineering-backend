import {
  canonicalUploadUrlPrefix,
  uploadUrlOptionsFromEnv,
} from "@apps/backend/modules/upload/utils/upload-url.util";

/**
 * 테스트 환경에서 업로드 API가 발급하는 꼴의 사진 주소(`uploads/<이름>`).
 * 로컬 .env.test는 CLOUDFRONT_DOMAIN이 있고 CI는 S3 버킷만 있어(create-env-test.sh) 환경값으로 만든다.
 */
export function testUploadUrl(name: string): string {
  return `${canonicalUploadUrlPrefix(uploadUrlOptionsFromEnv())}uploads/${name}`;
}

/** 같은 파일을 S3 경로 꼴로(`https://s3.{region}.amazonaws.com/{bucket}/uploads/<이름>`) */
export function testUploadPathStyleUrl(name: string): string {
  const { bucket, region } = uploadUrlOptionsFromEnv();
  return `https://s3.${region}.amazonaws.com/${bucket}/uploads/${name}`;
}
