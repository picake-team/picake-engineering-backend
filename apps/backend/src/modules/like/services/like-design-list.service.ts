import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import type { DesignLikesResponseDto } from "@apps/backend/modules/like/dto/like-design.dto";

/**
 * 디자인 좋아요 수·내 좋아요 조회 서비스(케이크 디자인 모음, 기획 I-112).
 * 디자인 모음은 웹에 고정된 수십 장이라 한 번에 전부 센다
 */
@Injectable()
export class LikeDesignListService {
  constructor(private readonly prisma: PrismaService) {}

  async getDesignLikes(userId?: string): Promise<DesignLikesResponseDto> {
    const [groups, mine] = await Promise.all([
      this.prisma.designLike.groupBy({ by: ["designId"], _count: { _all: true } }),
      userId
        ? this.prisma.designLike.findMany({
            where: { consumerId: userId },
            select: { designId: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })
        : Promise.resolve([]),
    ]);
    const counts: Record<string, number> = {};
    for (const g of groups) counts[g.designId] = g._count._all;
    return { counts, myLikes: mine.map((l) => l.designId) };
  }
}
