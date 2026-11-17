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
  return uploadUrlPrefixes(uploadUrlOptionsFromEnv());
}

export type UploadUrlOptions = {
  cloudfrontDomain?: string | null;
  bucket?: string | null;
  region?: string | null;
};

/** 이 서비스가 발급한(또는 예전에 발급한) 주소 앞부분: CloudFront, S3 가상 호스트, S3 경로 꼴 */
function uploadUrlPrefixes(opts: UploadUrlOptions): string[] {
  const prefixes: string[] = [];
  if (opts.cloudfrontDomain) prefixes.push(`https://${opts.cloudfrontDomain}/`);
  if (opts.bucket && opts.region) {
    prefixes.push(`https://${opts.bucket}.s3.${opts.region}.amazonaws.com/`);
    prefixes.push(`https://s3.${opts.region}.amazonaws.com/${opts.bucket}/`);
  }
  return prefixes;
}

/** 업로드 API가 지금 발급하는 꼴의 앞부분(CloudFront가 있으면 CloudFront, 없으면 S3). 설정이 없으면 null */
export function canonicalUploadUrlPrefix(opts: UploadUrlOptions): string | null {
  return uploadUrlPrefixes(opts)[0] ?? null;
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
export function uploadUrlToKey(url: string, opts: UploadUrlOptions): string | null {
  const prefix = uploadUrlPrefixes(opts).find((p) => url.startsWith(p));
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

/** 서버 환경값의 업로드 주소 설정(UploadCreateService와 같은 값) */
export function uploadUrlOptionsFromEnv(): UploadUrlOptions {
  return {
    cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN,
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
  };
}

/** 업로드 API가 만드는 키(`uploads/<시각>_<무작위>.<확장자>`, 한 조각)인지. 이 모양만 지운다 */
export function isUploadKey(key: string): boolean {
  return /^uploads\/[^/]+$/.test(key) && !key.includes("..");
}

/** 키를 주소에 넣는 꼴로(조각마다 인코딩, UploadCreateService와 같음) */
export function encodeUploadKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * 같은 파일(키)을 가리키는 주소 꼴 전부(CloudFront·S3 두 꼴). 다른 칸이 이 파일을 쓰는지 볼 때 쓴다.
 * 주소 문자열로만 비교하면 `?x`·`#x`·다른 인코딩·S3 꼴을 붙인 주소가 "아무도 안 쓰는 주소"로 보여
 * 남의 상품 사진 파일이 지워진다(2026-11-17 검토).
 */
export function uploadUrlSpellings(key: string, opts: UploadUrlOptions): string[] {
  const encoded = encodeUploadKey(key);
  const keys = encoded === key ? [key] : [encoded, key];
  return uploadUrlPrefixes(opts).flatMap((prefix) => keys.map((k) => `${prefix}${k}`));
}

/**
 * 업로드 API가 지금 발급하는 꼴 그대로인지(CloudFront가 있으면 CloudFront, 없으면 S3 꼴, 키는 조각마다 인코딩).
 * 뒤에 `?`·`#`을 붙이거나 다르게 인코딩한 주소는 받지 않는다. 업로드 설정이 없는 환경(테스트 등)은 https면 허용.
 */
export function isCanonicalUploadUrl(
  url: string,
  opts: UploadUrlOptions = uploadUrlOptionsFromEnv(),
): boolean {
  const prefix = canonicalUploadUrlPrefix(opts);
  if (!prefix) return url.startsWith("https://");
  const key = uploadUrlToKey(url, opts);
  if (!key || !isUploadKey(key)) return false;
  return url === `${prefix}${encodeUploadKey(key)}`;
}
