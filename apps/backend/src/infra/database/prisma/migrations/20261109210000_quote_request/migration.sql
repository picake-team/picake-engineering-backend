-- 손님 견적 요청(기획 I-46 1단계 ①): 요청서와 물어볼 가게. 받을 동네는 동네 이름과 중심 좌표만 저장(기기 좌표 없음)
-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('OPEN', 'CONNECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteRequestCloseReason" AS ENUM ('EXPIRED', 'CONSUMER');

-- CreateEnum
CREATE TYPE "QuoteCakeSize" AS ENUM ('LUNCHBOX', 'MINI', 'NO1', 'NO2', 'NO3', 'LARGER');

-- CreateEnum
CREATE TYPE "QuoteCream" AS ENUM ('FRESH_CREAM', 'BUTTER_CREAM', 'CREAM_CHEESE');

-- CreateEnum
CREATE TYPE "QuoteRequestEntry" AS ENUM ('HOME', 'SEARCH', 'MAP', 'STORE', 'MYPAGE');

-- CreateEnum
CREATE TYPE "QuoteRequestStoreAddedBy" AS ENUM ('CONSUMER', 'ADMIN');

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "consumer_id" TEXT NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'OPEN',
    "close_reason" "QuoteRequestCloseReason",
    "closed_at" TIMESTAMP(3),
    "pickup_date" TEXT NOT NULL,
    "pickup_hour_from" INTEGER,
    "pickup_hour_to" INTEGER,
    "pickup_start_at" TIMESTAMP(3) NOT NULL,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "area_name" TEXT,
    "area_sido" TEXT,
    "area_latitude" DOUBLE PRECISION,
    "area_longitude" DOUBLE PRECISION,
    "distance_km" INTEGER,
    "only_designated_stores" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(500),
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "size" "QuoteCakeSize" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "creams" "QuoteCream"[] DEFAULT ARRAY[]::"QuoteCream"[],
    "flavor_note" VARCHAR(30),
    "budget_min" INTEGER NOT NULL,
    "budget_max" INTEGER,
    "request_note" VARCHAR(200),
    "entry" "QuoteRequestEntry",
    "consented_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_stores" (
    "id" TEXT NOT NULL,
    "quote_request_id" TEXT NOT NULL,
    "added_by" "QuoteRequestStoreAddedBy" NOT NULL DEFAULT 'CONSUMER',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "store_id" TEXT,
    "kakao_place_id" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "place_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_request_stores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_requests_consumer_id_created_at_idx" ON "quote_requests"("consumer_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_requests_status_deadline_at_idx" ON "quote_requests"("status", "deadline_at");

-- CreateIndex
CREATE INDEX "quote_requests_created_at_idx" ON "quote_requests"("created_at");

-- CreateIndex
CREATE INDEX "quote_request_stores_store_id_idx" ON "quote_request_stores"("store_id");

-- CreateIndex
CREATE INDEX "quote_request_stores_kakao_place_id_idx" ON "quote_request_stores"("kakao_place_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_stores_quote_request_id_store_id_key" ON "quote_request_stores"("quote_request_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_stores_quote_request_id_kakao_place_id_key" ON "quote_request_stores"("quote_request_id", "kakao_place_id");

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_consumer_id_fkey" FOREIGN KEY ("consumer_id") REFERENCES "consumers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_stores" ADD CONSTRAINT "quote_request_stores_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_stores" ADD CONSTRAINT "quote_request_stores_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

