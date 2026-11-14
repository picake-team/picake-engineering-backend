import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiExtraModels } from "@nestjs/swagger";
import { LikeService } from "@apps/backend/modules/like/like.service";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import {
  LIKE_ERROR_MESSAGES,
  LIKE_SUCCESS_MESSAGES,
} from "@apps/backend/modules/like/constants/like.constants";
import { PRODUCT_ERROR_MESSAGES } from "@apps/backend/modules/product/constants/product.constants";
import { STORE_ERROR_MESSAGES } from "@apps/backend/modules/store/constants/store.constants";
import { LikeProductResponseDto } from "@apps/backend/modules/like/dto/like-product-create.dto";
import { LikeProductDeleteResponseDto } from "@apps/backend/modules/like/dto/like-product-delete.dto";
import { LikeStoreResponseDto } from "@apps/backend/modules/like/dto/like-store-create.dto";
import { LikeStoreDeleteResponseDto } from "@apps/backend/modules/like/dto/like-store-delete.dto";
import {
  DesignLikesResponseDto,
  LikeDesignResponseDto,
} from "@apps/backend/modules/like/dto/like-design.dto";

/**
 * 좋아요 관련 컨트롤러 (사용자용)
 */
@ApiTags("좋아요")
@ApiExtraModels(
  LikeProductResponseDto,
  LikeProductDeleteResponseDto,
  LikeStoreResponseDto,
  LikeStoreDeleteResponseDto,
  LikeDesignResponseDto,
  DesignLikesResponseDto,
)
@Controller(`${AUDIENCE.CONSUMER}`)
@Auth({ isPublic: true })
export class ConsumerLikeController {
  constructor(private readonly likeService: LikeService) {}

  /**
   * 상품 좋아요 추가 API
   */
  @Post("products/:productId/like")
  @Auth({ isPublic: false, audiences: ["consumer"] }) // 구매자 JWT(aud: user)만 허용
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "(로그인 필요) 상품 좋아요 추가",
    description: "상품에 좋아요를 추가합니다.",
  })
  @SwaggerResponse(201, { dataDto: LikeProductResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(404, { dataExample: createMessageObject(PRODUCT_ERROR_MESSAGES.NOT_FOUND) })
  @SwaggerResponse(409, {
    dataExample: createMessageObject(LIKE_ERROR_MESSAGES.PRODUCT_LIKE_ALREADY_EXISTS),
  })
  async addProductLike(
    @Param("productId") productId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.likeService.addProductLikeForUser(req.user.sub, productId);
    return { message: LIKE_SUCCESS_MESSAGES.PRODUCT_LIKE_ADDED };
  }

  /**
   * 상품 좋아요 삭제 API
   */
  @Delete("products/:productId/like")
  @Auth({ isPublic: false, audiences: ["consumer"] }) // 구매자 JWT(aud: user)만 허용
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 상품 좋아요 삭제",
    description: "상품의 좋아요를 취소합니다.",
  })
  @SwaggerResponse(200, { dataDto: LikeProductDeleteResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(404, {
    dataExample: createMessageObject(LIKE_ERROR_MESSAGES.PRODUCT_LIKE_NOT_FOUND),
  })
  async removeProductLike(
    @Param("productId") productId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.likeService.removeProductLikeForUser(req.user.sub, productId);
    return { message: LIKE_SUCCESS_MESSAGES.PRODUCT_LIKE_REMOVED };
  }

  /**
   * 스토어 좋아요 추가 API
   */
  @Post("store/:storeId/like")
  @Auth({ isPublic: false, audiences: ["consumer"] }) // 구매자 JWT(aud: user)만 허용
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "(로그인 필요) 스토어 좋아요 추가",
    description: "스토어에 좋아요를 추가합니다.",
  })
  @SwaggerResponse(201, { dataDto: LikeStoreResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(404, { dataExample: createMessageObject(STORE_ERROR_MESSAGES.NOT_FOUND) })
  @SwaggerResponse(409, {
    dataExample: createMessageObject(LIKE_ERROR_MESSAGES.STORE_LIKE_ALREADY_EXISTS),
  })
  async addStoreLike(
    @Param("storeId") storeId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.likeService.addStoreLikeForUser(req.user.sub, storeId);
    return { message: LIKE_SUCCESS_MESSAGES.STORE_LIKE_ADDED };
  }

  /**
   * 스토어 좋아요 삭제 API
   */
  @Delete("store/:storeId/like")
  @Auth({ isPublic: false, audiences: ["consumer"] }) // 구매자 JWT(aud: user)만 허용
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 스토어 좋아요 삭제",
    description: "스토어의 좋아요를 취소합니다.",
  })
  @SwaggerResponse(200, { dataDto: LikeStoreDeleteResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(404, {
    dataExample: createMessageObject(LIKE_ERROR_MESSAGES.STORE_LIKE_NOT_FOUND),
  })
  async removeStoreLike(
    @Param("storeId") storeId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.likeService.removeStoreLikeForUser(req.user.sub, storeId);
    return { message: LIKE_SUCCESS_MESSAGES.STORE_LIKE_REMOVED };
  }

  /**
   * 케이크 디자인 모음(기획 I-112) 좋아요 수·내 좋아요 API.
   * 디자인은 DB가 아니라 웹에 있어 서버는 디자인 ID만 받는다
   */
  @Get("designs/likes")
  @Auth({ isOptionalPublic: true, audiences: ["consumer"] }) // 로그인하지 않아도 수는 보이고, 로그인하면 내 좋아요도
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "디자인 좋아요 수·내 좋아요",
    description:
      "케이크 디자인 모음의 디자인 ID별 좋아요 수(1개 이상만)와 내가 좋아요한 디자인 ID(최근 누른 순)를 돌려줍니다. 로그인하지 않았으면 myLikes는 []입니다.",
  })
  @SwaggerResponse(200, { dataDto: DesignLikesResponseDto })
  async getDesignLikes(@Request() req: { user?: JwtVerifiedPayload }) {
    return this.likeService.getDesignLikes(req.user?.sub);
  }

  /**
   * 디자인 좋아요 추가 API(이미 눌렀으면 그대로 성공)
   */
  @Post("designs/:designId/like")
  @Auth({ isPublic: false, audiences: ["consumer"] }) // 구매자 JWT(aud: user)만 허용
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "(로그인 필요) 디자인 좋아요 추가",
    description:
      "케이크 디자인 모음의 디자인에 좋아요를 추가합니다. 디자인은 웹에 있어 ID 모양(소문자-하이픈, 80자까지)만 확인하고, 이미 눌렀으면 그대로 성공합니다.",
  })
  @SwaggerResponse(201, { dataDto: LikeDesignResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, { dataExample: createMessageObject(LIKE_ERROR_MESSAGES.DESIGN_NOT_FOUND) })
  async addDesignLike(
    @Param("designId") designId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.likeService.addDesignLikeForUser(req.user.sub, designId);
    return { message: LIKE_SUCCESS_MESSAGES.DESIGN_LIKE_ADDED };
  }

  /**
   * 디자인 좋아요 취소 API(누르지 않았어도 그대로 성공)
   */
  @Delete("designs/:designId/like")
  @Auth({ isPublic: false, audiences: ["consumer"] }) // 구매자 JWT(aud: user)만 허용
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 디자인 좋아요 취소",
    description: "디자인 좋아요를 취소합니다. 누르지 않은 디자인이어도 그대로 성공합니다.",
  })
  @SwaggerResponse(200, { dataDto: LikeDesignResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, { dataExample: createMessageObject(LIKE_ERROR_MESSAGES.DESIGN_NOT_FOUND) })
  async removeDesignLike(
    @Param("designId") designId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    await this.likeService.removeDesignLikeForUser(req.user.sub, designId);
    return { message: LIKE_SUCCESS_MESSAGES.DESIGN_LIKE_REMOVED };
  }
}
