import { Module } from "@nestjs/common";
import { NaverPlaceModule } from "@apps/backend/modules/naver-place/naver-place.module";
import { UploadModule } from "@apps/backend/modules/upload/upload.module";
import { ProductNaverImportService } from "@apps/backend/modules/product-naver/services/product-naver-import.service";
import { ProductNaverLinkService } from "@apps/backend/modules/product-naver/services/product-naver-link.service";
import { ProductAiDraftService } from "@apps/backend/modules/product-naver/services/product-ai-draft.service";

/**
 * 네이버 상품 가져오기·연결, 상세설명 AI 초안 모듈 (판매자용)
 */
@Module({
  imports: [NaverPlaceModule, UploadModule],
  providers: [ProductNaverImportService, ProductNaverLinkService, ProductAiDraftService],
  exports: [ProductNaverImportService, ProductNaverLinkService, ProductAiDraftService],
})
export class ProductNaverModule {}
