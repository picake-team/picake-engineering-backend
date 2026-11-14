import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { DESIGN_LIKE_LIMITS } from "@apps/backend/modules/like/constants/like.constants";
import type { DesignLikesResponseDto } from "@apps/backend/modules/like/dto/like-design.dto";

/**
 * 디자인 좋아요 수·내 좋아요 조회 서비스(케이크 디자인 모음, 기획 I-112).
 *
 * 로그인 없이 부르는 경로라 응답 크기를 묶어 둔다: 수는 좋아요가 있는 디자인만(묶으면 1개 이상만 나온다)
 * 많은 순 500개(DESIGN_LIKE_LIMITS.COUNTS_TOP)까지, 내 좋아요는 손님 한도(300개)까지.
 * 디자인 모음은 웹에 고정된 수십 장이라 실제 디자인은 다 들어간다
 */
@Injectable()
export class LikeDesignListService {
  constructor(private readonly prisma: PrismaService) {}

  async getDesignLikes(userId?: string): Promise<DesignLikesResponseDto> {
    const [groups, mine] = await Promise.all([
      this.prisma.designLike.groupBy({
        by: ["designId"],
        _count: { designId: true },
        // 수가 같으면 ID 순으로(어떤 디자인이 잘리는지 흔들리지 않게)
        orderBy: [{ _count: { designId: "desc" } }, { designId: "asc" }],
        take: DESIGN_LIKE_LIMITS.COUNTS_TOP,
      }),
      userId
        ? this.prisma.designLike.findMany({
            where: { consumerId: userId },
            select: { designId: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: DESIGN_LIKE_LIMITS.MAX_PER_CONSUMER,
          })
        : Promise.resolve([]),
    ]);
    const counts: Record<string, number> = {};
    for (const g of groups) counts[g.designId] = g._count.designId;
    return { counts, myLikes: mine.map((l) => l.designId) };
  }
}
