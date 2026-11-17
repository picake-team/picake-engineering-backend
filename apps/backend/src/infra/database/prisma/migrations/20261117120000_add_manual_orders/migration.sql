-- 사장님이 Picake 밖(카톡·인스타·전화 등)에서 받아 직접 적은 주문(기획 I-42, 2026-11-17 운영자).
-- Picake 주문(orders)과 다른 표라 알림톡·관리자 숫자·정산과 섞이지 않는다.
-- 다른 캘린더로 내보내기 주소의 비밀 값과 손님 이름 보이기 설정을 stores에 더한다.
-- 표·열을 더할 뿐이라 옛 서버와 함께 돌아도 된다.

-- CreateEnum
CREATE TYPE "ManualOrderSource" AS ENUM ('KAKAO', 'INSTAGRAM', 'PHONE', 'NAVER', 'OTHER');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "calendar_feed_show_customer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "calendar_feed_token" TEXT;

-- CreateTable
CREATE TABLE "manual_orders" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "pickup_date" VARCHAR(10) NOT NULL,
    "pickup_time" VARCHAR(5),
    "cake_name" VARCHAR(100) NOT NULL,
    "lettering" VARCHAR(100),
    "price" INTEGER,
    "paid" BOOLEAN,
    "customer_name" VARCHAR(50),
    "source" "ManualOrderSource" NOT NULL,
    "memo" VARCHAR(500),
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_orders_store_id_pickup_date_idx" ON "manual_orders"("store_id", "pickup_date");

-- CreateIndex
CREATE UNIQUE INDEX "stores_calendar_feed_token_key" ON "stores"("calendar_feed_token");

-- AddForeignKey
ALTER TABLE "manual_orders" ADD CONSTRAINT "manual_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
