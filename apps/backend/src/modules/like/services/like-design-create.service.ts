import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { isValidDesignId } from "@apps/backend/common/constants/design-gallery.constants";
import {
  DESIGN_LIKE_LIMITS,
  LIKE_ERROR_MESSAGES,
} from "@apps/backend/modules/like/constants/like.constants";

/**
 * 디자인 좋아요 추가 서비스(케이크 디자인 모음, 기획 I-112).
 * 디자인은 DB가 아니라 웹에 있어 ID 모양만 확인한다. 이미 눌렀으면 그대로 성공(두 번 눌러도 하나)
 *
 * 모양만 맞으면 아무 ID나 받으므로 손님 한 명이 300개(DESIGN_LIKE_LIMITS.MAX_PER_CONSUMER)까지만 누를 수 있다.
 * 이미 누른 디자인은 한도에 닿아도 그대로 성공한다(웹이 상태를 다시 맞출 때 막히지 않게)
 */
@Injectable()
export class LikeDesignCreateService {
  constructor(private readonly prisma: PrismaService) {}

  async addDesignLikeForUser(userId: string, designId: string): Promise<void> {
    if (!isValidDesignId(designId)) {
      throw new BadRequestException(LIKE_ERROR_MESSAGES.DESIGN_NOT_FOUND);
    }
    await this.prisma.$transaction(async (tx) => {
      // 같은 손님의 좋아요를 한 줄로 세운다: 동시에 여러 개를 눌러도 한도를 넘지 않고,
      // 같은 디자인을 동시에 두 번 눌러도 unique 제약에 걸리지 않는다.
      // 키 두 개 형식이라 스토어 등록의 키 하나 잠금(hashtext(사업자번호))과 겹치지 않는다
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('design_like'), hashtext(${userId}))`;
      const existing = await tx.designLike.findUnique({
        where: { consumerId_designId: { consumerId: userId, designId } },
        select: { id: true },
      });
      if (existing) return;

      const count = await tx.designLike.count({ where: { consumerId: userId } });
      if (count >= DESIGN_LIKE_LIMITS.MAX_PER_CONSUMER) {
        throw new BadRequestException(LIKE_ERROR_MESSAGES.DESIGN_LIKE_LIMIT);
      }
      await tx.designLike.create({ data: { consumerId: userId, designId } });
    });
  }
}
