-- 옛 맛 칸 정리: 2026-11-05(20261105150000) 맛을 추가 옵션 '맛'으로 옮긴 뒤, 배포 중 구버전 서버가 읽을 수 있게 남겨 둔 레거시 칸을 지운다.
-- 그 뒤 서버는 이 칸을 읽거나 쓰지 않는다. 주문 기록(전자상거래법 보존)의 맛은 order_items.selected_options의 '맛'에 있다.
-- 옮기기를 다시 돌리지 않는다: 11-05 뒤 옵션 변경으로 '맛'을 뺀 주문에 옛 맛과 가격이 다시 붙을 수 있다.
ALTER TABLE "products" DROP COLUMN IF EXISTS "cake_flavor_options";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "flavor_id";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "flavor_display_name";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "flavor_price";
