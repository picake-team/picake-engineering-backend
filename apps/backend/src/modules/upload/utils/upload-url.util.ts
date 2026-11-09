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

/**
 * 업로드 API가 발급한 파일 URL을 S3 키로 되돌린다(지우기용). 이 서비스가 올린 파일이 아니면 null.
 * URL은 경로 조각마다 인코딩되어 있으므로 조각마다 되돌린다.
 */
export function uploadUrlToKey(
  url: string,
  opts: { cloudfrontDomain?: string | null; bucket?: string | null; region?: string | null },
): string | null {
  const prefixes: string[] = [];
  if (opts.cloudfrontDomain) prefixes.push(`https://${opts.cloudfrontDomain}/`);
  if (opts.bucket && opts.region) {
    prefixes.push(`https://${opts.bucket}.s3.${opts.region}.amazonaws.com/`);
    prefixes.push(`https://s3.${opts.region}.amazonaws.com/${opts.bucket}/`);
  }
  const prefix = prefixes.find((p) => url.startsWith(p));
  if (!prefix) return null;
  const rest = url.slice(prefix.length).split(/[?#]/)[0];
  if (!rest || rest.includes("..")) return null;
  try {
    return rest
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}
