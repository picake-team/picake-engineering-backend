-- 견적으로 만든 예약(기획 I-01, 운영자 결정 2026-11-13): 입점 가게 견적을 고른 손님이 "이 견적으로 예약하기"로 예약신청.
-- 상품이 없는 예약이라 product_id를 비울 수 있게 하고, 어느 견적으로 만들었는지 quote_id로 남긴다.
ALTER TABLE "orders" ALTER COLUMN "product_id" DROP NOT NULL;
ALTER TABLE "orders" ADD COLUMN "quote_id" TEXT;
CREATE INDEX "orders_quote_id_idx" ON "orders"("quote_id");
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
