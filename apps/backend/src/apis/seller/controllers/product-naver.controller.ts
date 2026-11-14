import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { createMessageObject } from "@apps/backend/common/utils/message.util";
import { NAVER_BOOKING_ERROR_MESSAGES } from "@apps/backend/modules/naver-place/constants/naver-booking.constants";
import { PRODUCT_AI_DRAFT_ERROR_MESSAGES } from "@apps/backend/modules/product-naver/constants/product-naver.constants";
import { PRODUCT_NAVER_LINK_MESSAGES } from "@apps/backend/modules/product/utils/product-naver-link.util";
import { ProductNaverImportService } from "@apps/backend/modules/product-naver/services/product-naver-import.service";
import { ProductNaverLinkService } from "@apps/backend/modules/product-naver/services/product-naver-link.service";
import { ProductAiDraftService } from "@apps/backend/modules/product-naver/services/product-ai-draft.service";
import {
  ImportNaverImagesRequestDto,
  ImportNaverImagesResponseDto,
  LinkNaverItemRequestDto,
  NaverProductDetailResponseDto,
  NaverProductListResponseDto,
  ProductDescriptionDraftRequestDto,
  ProductDescriptionDraftResponseDto,
  ProductNaverLinkResponseDto,
} from "@apps/backend/modules/product-naver/dto/product-naver.dto";

/**
 * 네이버 상품 가져오기·연결, 상세설명 AI 초안 컨트롤러 (판매자)
 * 가져오기는 저장하지 않는다. 판매자가 고른 값을 상품 등록·수정으로 저장한다.
 */
@ApiTags("상품 - 네이버 가져오기")
@Controller(AUDIENCE.SELLER)
@Auth({ isPublic: false, audiences: ["seller"] })
export class SellerProductNaverController {
  constructor(
    private readonly importService: ProductNaverImportService,
    private readonly linkService: ProductNaverLinkService,
    private readonly aiDraftService: ProductAiDraftService,
  ) {}

  @Get("store/:storeId/naver-products")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요) 연결한 네이버 매장의 상품 목록",
    description:
      "스토어에 연결한 네이버 매장의 상품을 읽습니다. 네이버 예약을 쓰는 매장은 예약 상품(`source: BOOKING`), 아니면 플레이스 메뉴(`source: MENU`)입니다. \n이미 연결한 Picake 상품은 `linkedProduct`로 알려 줍니다.",
  })
  @SwaggerResponse(200, { dataDto: NaverProductListResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, {
    dataExample: createMessageObject(NAVER_BOOKING_ERROR_MESSAGES.NOT_CONNECTED),
  })
  @SwaggerResponse(502, {
    dataExample: createMessageObject(NAVER_BOOKING_ERROR_MESSAGES.FETCH_FAILED),
  })
  async list(@Param("storeId") storeId: string, @Request() req: { user: JwtVerifiedPayload }) {
    return await this.importService.listForSeller(storeId, req.user);
  }

  @Get("store/:storeId/naver-products/:itemKey")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요) 네이버 상품 1개의 등록 제안값",
    description:
      "상품 이름·설명·주의사항·사진과 옵션을 읽어 Picake 사이즈·추가 옵션 후보로 바꿔 돌려줍니다. 저장은 하지 않습니다. \n옵션 용도·가격 의미가 분명하지 않으면 `selectedByDefault: false`와 `warnings`로 알려 줍니다.",
  })
  @SwaggerResponse(200, { dataDto: NaverProductDetailResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(404, {
    dataExample: createMessageObject(NAVER_BOOKING_ERROR_MESSAGES.ITEM_NOT_FOUND),
  })
  @SwaggerResponse(502, {
    dataExample: createMessageObject(NAVER_BOOKING_ERROR_MESSAGES.FETCH_FAILED),
  })
  async detail(
    @Param("storeId") storeId: string,
    @Param("itemKey") itemKey: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.importService.detailForSeller(storeId, itemKey, req.user);
  }

  @Post("store/:storeId/naver-products/:itemKey/images")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요) 고른 네이버 사진을 Picake에 올리기",
    description:
      "상품 상세 응답의 `imageUrls` 순번으로 사진을 골라 Picake 저장소에 올리고 주소를 돌려줍니다. 사진 주소는 받지 않고 서버가 네이버에서 다시 읽습니다.",
  })
  @SwaggerResponse(200, { dataDto: ImportNaverImagesResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, {
    dataExample: createMessageObject(NAVER_BOOKING_ERROR_MESSAGES.IMAGE_FAILED),
  })
  async importImages(
    @Param("storeId") storeId: string,
    @Param("itemKey") itemKey: string,
    @Body() body: ImportNaverImagesRequestDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.importService.importImagesForSeller(storeId, itemKey, body.indexes, req.user);
  }

  @Put("products/:productId/naver-item")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요) 상품을 네이버 예약 상품과 연결",
    description:
      "다시 불러오기 때 비교할 네이버 예약 상품을 정합니다. 상품 내용은 바꾸지 않습니다. 같은 스토어에서 이미 다른 상품과 연결한 네이버 상품이면 409입니다.",
  })
  @SwaggerResponse(200, { dataDto: ProductNaverLinkResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(409, {
    dataExample: createMessageObject(
      PRODUCT_NAVER_LINK_MESSAGES.ALREADY_LINKED("무화과 생크림 케이크"),
    ),
  })
  async link(
    @Param("productId") productId: string,
    @Body() body: LinkNaverItemRequestDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.linkService.linkForSeller(productId, body.bizItemId, req.user);
  }

  @Delete("products/:productId/naver-item")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 상품의 네이버 연결 끊기",
    description: "네이버 연결만 끊습니다. 상품 내용은 그대로 둡니다.",
  })
  @SwaggerResponse(200, { dataDto: ProductNaverLinkResponseDto })
  @SwaggerAuthResponses()
  async unlink(
    @Param("productId") productId: string,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.linkService.unlinkForSeller(productId, req.user);
  }

  @Post("store/:storeId/products/description-draft")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: "(로그인 필요) 상품 상세설명 AI 초안",
    description:
      "네이버 설명·판매자가 확인한 사실·옵션 요약만 근거로 상세설명 초안을 만듭니다. 근거가 없는 중요한 정보는 `[판매자 확인 필요]`로 남깁니다. 저장하지 않습니다. 판매자당 하루 30번, 모든 판매자를 합쳐 하루 300번(넘으면 503).",
  })
  @SwaggerResponse(200, { dataDto: ProductDescriptionDraftResponseDto })
  @SwaggerAuthResponses()
  @SwaggerResponse(400, {
    dataExample: createMessageObject(PRODUCT_AI_DRAFT_ERROR_MESSAGES.NO_SOURCE),
  })
  @SwaggerResponse(429, {
    dataExample: createMessageObject(PRODUCT_AI_DRAFT_ERROR_MESSAGES.DAILY_LIMIT),
  })
  @SwaggerResponse(503, {
    dataExample: createMessageObject(PRODUCT_AI_DRAFT_ERROR_MESSAGES.UNAVAILABLE_TODAY),
  })
  async descriptionDraft(
    @Param("storeId") storeId: string,
    @Body() body: ProductDescriptionDraftRequestDto,
    @Request() req: { user: JwtVerifiedPayload },
  ) {
    return await this.aiDraftService.createDraftForSeller(storeId, body, req.user);
  }
}
