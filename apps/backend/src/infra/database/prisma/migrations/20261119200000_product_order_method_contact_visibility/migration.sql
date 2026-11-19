-- 상품 화면 견적·문의(기획 I-01, 운영자 2026-11-19)
-- 1) 커스텀 케이크는 사장님이 "주문 받는 방법"을 예약 받기 / 견적 받기 중 하나로 고른다. 지금 상품은 모두 예약 받기.
CREATE TYPE "ProductOrderMethod" AS ENUM ('RESERVATION', 'QUOTE');
ALTER TABLE "products" ADD COLUMN "order_method" "ProductOrderMethod" NOT NULL DEFAULT 'RESERVATION';

-- 2) 상품 화면에서 연 견적 요청: 들어온 곳 PRODUCT와 그 상품
ALTER TYPE "QuoteRequestEntry" ADD VALUE 'PRODUCT';
ALTER TABLE "quote_requests" ADD COLUMN "product_id" TEXT;

-- 3) 손님 문의 "손님에게 보이기": 채팅·카톡 채널·인스타·전화. 지금 가게는 모두 켜짐(지금과 같게 보임)
ALTER TABLE "stores" ADD COLUMN "chat_inquiry_visible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "kakao_channel_visible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "instagram_visible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "phone_visible" BOOLEAN NOT NULL DEFAULT true;
