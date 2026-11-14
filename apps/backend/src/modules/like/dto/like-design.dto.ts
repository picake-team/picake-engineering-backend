import { ApiProperty } from "@nestjs/swagger";
import { LIKE_SUCCESS_MESSAGES } from "@apps/backend/modules/like/constants/like.constants";

/**
 * 디자인 좋아요 추가·취소 응답 DTO(케이크 디자인 모음, 기획 I-112)
 */
export class LikeDesignResponseDto {
  @ApiProperty({
    description: "응답 메시지",
    example: LIKE_SUCCESS_MESSAGES.DESIGN_LIKE_ADDED,
  })
  message: string;
}

/**
 * 디자인 좋아요 수와 내 좋아요(케이크 디자인 모음, 기획 I-112)
 */
export class DesignLikesResponseDto {
  @ApiProperty({
    type: "object",
    additionalProperties: { type: "number" },
    description: "디자인 ID별 좋아요 수(1개 이상인 디자인만, 많은 순 500개까지)",
    example: { "bento-heart-lettering": 12, "mini-ribbon": 3 },
  })
  counts: Record<string, number>;

  @ApiProperty({
    type: [String],
    description: "내가 좋아요한 디자인 ID(최근 누른 순, 300개까지). 로그인하지 않았으면 []",
    example: ["mini-ribbon"],
  })
  myLikes: string[];
}
