import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { isValidDesignId } from "@apps/backend/common/constants/design-gallery.constants";
import { LIKE_ERROR_MESSAGES } from "@apps/backend/modules/like/constants/like.constants";

/**
 * 디자인 좋아요 추가 서비스(케이크 디자인 모음, 기획 I-112).
 * 디자인은 DB가 아니라 웹에 있어 ID 모양만 확인한다. 이미 눌렀으면 그대로 성공(두 번 눌러도 하나)
 */
@Injectable()
export class LikeDesignCreateService {
  constructor(private readonly prisma: PrismaService) {}

  async addDesignLikeForUser(userId: string, designId: string): Promise<void> {
    if (!isValidDesignId(designId)) {
      throw new BadRequestException(LIKE_ERROR_MESSAGES.DESIGN_NOT_FOUND);
    }
    // 동시에 두 번 눌러도 unique 제약에 걸려 실패하지 않게 겹치면 건너뛴다
    await this.prisma.designLike.createMany({
      data: [{ consumerId: userId, designId }],
      skipDuplicates: true,
    });
  }
}
