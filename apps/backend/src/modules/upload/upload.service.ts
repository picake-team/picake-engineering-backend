import { Injectable } from "@nestjs/common";
import { UploadCreateService } from "@apps/backend/modules/upload/services/upload-create.service";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";

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
   * 사진 주소를 담는 칸(12곳) 어디에도 남아 있지 않은 주소만 돌려준다.
   * 주소만 보고 지우면 채팅·견적에 들어온 주소가 상품·가게·배너 같은 다른 곳 파일일 때 그 파일이 지워지고,
   * 견적 예약 주문은 견적 사진 주소를 그대로 쓰므로 손님이 탈퇴하면 사장님 주문 사진이 깨졌다(11-16 검토).
   * 지운(deletedAt) 행도 참조로 센다(지우지 않는 쪽이 안전). 사진 칸을 새로 만들면 여기에 더한다.
   */
  async filterUnreferencedUrls(urls: string[]): Promise<string[]> {
    const unique = [...new Set(urls.filter(Boolean))];
    if (unique.length === 0) return [];
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
    ]);
    const used = new Set(found.flat());
    return unique.filter((url) => !used.has(url));
  }
}
