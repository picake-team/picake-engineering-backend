-- 주문 상품의 사이즈 길이를 소수로(상품 사이즈 옵션은 15.5cm처럼 소수를 받는데 주문 칸이 정수라 그 사이즈 예약이 실패했다).
-- 정수 → double precision은 값이 그대로 옮겨진다.
ALTER TABLE "order_items" ALTER COLUMN "size_length_cm" SET DATA TYPE DOUBLE PRECISION;
