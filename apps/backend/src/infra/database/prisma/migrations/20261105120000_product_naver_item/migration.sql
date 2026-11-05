-- 상품 네이버 예약 상품 연결 컬럼 추가 (상품 가져오기·다시 불러오기용)
ALTER TABLE "products" ADD COLUMN "naver_biz_item_id" TEXT,
ADD COLUMN "naver_linked_at" TIMESTAMP(3);

-- 네이버 상품 하나는 스토어 안에서 한 상품에만 연결 (NULL은 여러 개 허용)
CREATE UNIQUE INDEX "products_store_id_naver_biz_item_id_key" ON "products"("store_id", "naver_biz_item_id");
