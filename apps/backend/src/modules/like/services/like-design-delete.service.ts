import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { isValidDesignId } from "@apps/backend/common/constants/design-gallery.constants";
import { LIKE_ERROR_MESSAGES } from "@apps/backend/modules/like/constants/like.constants";

/**
 * 디자인 좋아요 취소 서비스(케이크 디자인 모음, 기획 I-112). 누르지 않았어도 그대로 성공
 */
@Injectable()
export class LikeDesignDeleteService {
  constructor(private readonly prisma: PrismaService) {}

  async removeDesignLikeForUser(userId: string, designId: string): Promise<void> {
    if (!isValidDesignId(designId)) {
      throw new BadRequestException(LIKE_ERROR_MESSAGES.DESIGN_NOT_FOUND);
    }
    await this.prisma.designLike.deleteMany({ where: { consumerId: userId, designId } });
  }
}
