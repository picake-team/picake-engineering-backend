-- 링크 효과(기획 I-45): 사장님이 보낸 가게·상품 링크로 들어온 손님 기기와, 그 링크로 들어와 한 예약을 센다.
-- 기기는 손님 기기에서 만든 임의 값만 저장하고 계정과 잇지 않는다.
CREATE TYPE "OrderEntrySource" AS ENUM ('STORE_LINK');

ALTER TABLE "orders" ADD COLUMN "entry_source" "OrderEntrySource";

CREATE INDEX "orders_store_id_entry_source_created_at_idx" ON "orders"("store_id", "entry_source", "created_at");

CREATE TABLE "store_link_visits" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "visitor_key" TEXT NOT NULL,
    "first_visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_link_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_link_visits_store_id_visitor_key_key" ON "store_link_visits"("store_id", "visitor_key");

CREATE INDEX "store_link_visits_store_id_last_visited_at_idx" ON "store_link_visits"("store_id", "last_visited_at");

ALTER TABLE "store_link_visits" ADD CONSTRAINT "store_link_visits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
