import { Injectable } from "@nestjs/common";
import { UploadCreateService } from "@apps/backend/modules/upload/services/upload-create.service";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import {
  isUploadKey,
  uploadUrlOptionsFromEnv,
  uploadUrlSpellings,
  uploadUrlToKey,
} from "@apps/backend/modules/upload/utils/upload-url.util";

/**
 * 업로드 서비스
 *
 * 모든 업로드 관련 기능을 통합하여 제공하는 메인 서비스입니다.
 * UploadCreateService를 조합하여 사용합니다.
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly uploadCreateService: UploadCreateService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 파일 업로드 (백엔드 내부에서 S3 업로드 처리)
   * 프론트엔드에서 파일을 받아서 백엔드가 S3에 업로드하는 방식
   */
  async uploadFile(file: { originalname: string; mimetype: string; buffer: Buffer }) {
    return await this.uploadCreateService.uploadFile(file);
  }

  /**
   * 이 서비스가 올린 파일 지우기(실패는 기록만). 아직 다른 곳이 쓰는 주소는 지우지 않는다(filterUnreferencedUrls).
   * 지울 행(채팅 글·견적 요청 등)을 먼저 지운 뒤 불러야 그 행의 참조를 세지 않는다.
   */
  async deleteFilesByUrl(urls: string[]): Promise<number> {
    const unused = await this.filterUnreferencedUrls(urls);
    return unused.length ? await this.uploadCreateService.deleteFilesByUrl(unused) : 0;
  }

  /**
   * 사진 주소를 담는 칸(13곳) 어디에도 남아 있지 않은 파일의 주소만 돌려준다(파일 하나에 주소 하나).
   * 주소만 보고 지우면 채팅·견적에 들어온 주소가 상품·가게·배너 같은 다른 곳 파일일 때 그 파일이 지워지고,
   * 견적 예약 주문은 견적 사진 주소를 그대로 쓰므로 손님이 탈퇴하면 사장님 주문 사진이 깨졌다(11-16 검토).
   * 비교는 주소 글자가 아니라 S3 키로 한다: 같은 파일 주소에 `?x`·`#x`·다른 인코딩·S3 꼴을 붙여 넣으면
   * 글자로는 "아무도 안 쓰는 주소"라 남의 상품 사진이 지워졌다(11-17 검토). 업로드 API가 만든 키(`uploads/…`)만 지운다.
   * 지운(deletedAt) 행도 참조로 센다(지우지 않는 쪽이 안전). 사진 칸을 새로 만들면 여기에 더한다.
   */
  async filterUnreferencedUrls(urls: string[]): Promise<string[]> {
    const opts = uploadUrlOptionsFromEnv();
    // 키마다 주소 하나(처음 받은 주소)
    const byKey = new Map<string, string>();
    for (const url of urls) {
      if (!url) continue;
      const key = uploadUrlToKey(url, opts);
      if (key && isUploadKey(key) && !byKey.has(key)) byKey.set(key, url);
    }
    if (byKey.size === 0) return [];
    // 같은 파일을 가리키는 꼴 전부 + 받은 주소 그대로
    const unique = [
      ...new Set(
        [...byKey.entries()].flatMap(([key, url]) => [url, ...uploadUrlSpellings(key, opts)]),
      ),
    ];
    const p = this.prisma;
    const inArray = { hasSome: unique };
    const inScalar = { in: unique };
    const found = await Promise.all([
      p.product
        .findMany({ where: { images: inArray }, select: { images: true } })
        .then((r) => r.flatMap((x) => x.images)),
      p.store
        .findMany({ where: { logoImageUrl: inScalar }, select: { logoImageUrl: true } })
        .then((r) => r.map((x) => x.logoImageUrl)),
      p.homeBanner
        .findMany({ where: { imageUrl: inScalar }, select: { imageUrl: true } })
        .then((r) => r.map((x) => x.imageUrl)),
      p.consumer
        .findMany({ where: { profileImageUrl: inScalar }, select: { profileImageUrl: true } })
        .then((r) => r.map((x) => x.profileImageUrl)),
      p.seller
        .findMany({ where: { profileImageUrl: inScalar }, select: { profileImageUrl: true } })
        .then((r) => r.map((x) => x.profileImageUrl)),
      p.productReview
        .findMany({ where: { imageUrls: inArray }, select: { imageUrls: true } })
        .then((r) => r.flatMap((x) => x.imageUrls)),
      p.storeFeed
        .findMany({ where: { imageUrls: inArray }, select: { imageUrls: true } })
        .then((r) => r.flatMap((x) => x.imageUrls)),
      p.order
        .findMany({ where: { productImages: inArray }, select: { productImages: true } })
        .then((r) => r.flatMap((x) => x.productImages)),
      p.orderItem
        .findMany({ where: { imageUrls: inArray }, select: { imageUrls: true } })
        .then((r) => r.flatMap((x) => x.imageUrls)),
      p.chatMessage
        .findMany({ where: { imageUrls: inArray }, select: { imageUrls: true } })
        .then((r) => r.flatMap((x) => x.imageUrls)),
      p.quoteRequest
        .findMany({ where: { photoUrls: inArray }, select: { photoUrls: true } })
        .then((r) => r.flatMap((x) => x.photoUrls)),
      p.quote
        .findMany({ where: { photoUrls: inArray }, select: { photoUrls: true } })
        .then((r) => r.flatMap((x) => x.photoUrls)),
      // 직접 적은 주문(기획 I-42)
      p.manualOrder
        .findMany({ where: { photoUrls: inArray }, select: { photoUrls: true } })
        .then((r) => r.flatMap((x) => x.photoUrls)),
    ]);
    const usedKeys = new Set(
      found
        .flat()
        .map((url) => (url ? uploadUrlToKey(url, opts) : null))
        .filter((key): key is string => key !== null),
    );
    return [...byKey.entries()].filter(([key]) => !usedKeys.has(key)).map(([, url]) => url);
  }
}
