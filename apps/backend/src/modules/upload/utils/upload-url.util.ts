/**
 * 업로드 API(UploadCreateService)가 발급하는 파일 URL인지 확인합니다.
 * 주문 옵션 사진처럼 클라이언트가 URL을 그대로 보내는 곳에서 외부 URL이 저장되지 않게 막는 용도입니다.
 *
 * 허용 접두사 (과거에 발급된 URL 형태까지 포함)
 * - https://{CLOUDFRONT_DOMAIN}/
 * - https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/
 * - https://s3.{AWS_REGION}.amazonaws.com/{S3_BUCKET}/
 *
 * 업로드 설정이 없는 환경(테스트 등)에서는 https URL이면 허용합니다.
 */
export function getAllowedUploadUrlPrefixes(): string[] {
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN;

  const prefixes: string[] = [];
  if (cloudfrontDomain) {
    prefixes.push(`https://${cloudfrontDomain}/`);
  }
  if (bucket && region) {
    prefixes.push(`https://${bucket}.s3.${region}.amazonaws.com/`);
    prefixes.push(`https://s3.${region}.amazonaws.com/${bucket}/`);
  }
  return prefixes;
}

export function isAllowedUploadUrl(url: string): boolean {
  const prefixes = getAllowedUploadUrlPrefixes();
  if (prefixes.length === 0) {
    return url.startsWith("https://");
  }
  return prefixes.some((prefix) => url.startsWith(prefix));
}
