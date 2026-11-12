-- 견적 ②(기획 I-46): 가게 견적·견적 링크·고르기·알림톡 기록, 판매자 앱 채팅으로 견적 받기(운영자 결정 2026-11-12)
-- CreateEnum
CREATE TYPE "QuoteSimilarity" AS ENUM ('EXACT', 'SIMILAR', 'INSPIRED');

-- CreateEnum
CREATE TYPE "QuoteSource" AS ENUM ('LINK', 'ADMIN', 'SELLER');

-- CreateEnum
CREATE TYPE "QuoteDeclineReason" AS ENUM ('FULLY_BOOKED', 'NOT_OUR_STYLE', 'BUDGET', 'OTHER');

-- AlterEnum


ALTER TYPE "ChatMessageKind" ADD VALUE 'QUOTE_REQUEST';
ALTER TYPE "ChatMessageKind" ADD VALUE 'QUOTE';
ALTER TYPE "ChatMessageKind" ADD VALUE 'QUOTE_CHOSEN';

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'QUOTE';

-- AlterEnum
ALTER TYPE "QuoteRequestCloseReason" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "only_for" "ChatSender",
ADD COLUMN     "ref_quote_request_id" TEXT;

-- AlterTable
ALTER TABLE "chat_threads" ADD COLUMN     "consumer_listed_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ops_alerted_at" TIMESTAMP(3),
ADD COLUMN     "shop_locked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "quote_request_stores" ADD COLUMN     "decline_reason" "QuoteDeclineReason",
ADD COLUMN     "declined_at" TIMESTAMP(3),
ADD COLUMN     "link_created_at" TIMESTAMP(3),
ADD COLUMN     "link_opened_at" TIMESTAMP(3),
ADD COLUMN     "link_token" TEXT,
ADD COLUMN     "sent_to_app_at" TIMESTAMP(3),
ADD COLUMN     "shop_id" TEXT;

-- AlterTable
ALTER TABLE "quote_requests" ADD COLUMN     "arrival_alimtalk_at" TIMESTAMP(3),
ADD COLUMN     "chosen_at" TIMESTAMP(3),
ADD COLUMN     "chosen_notified_at" TIMESTAMP(3),
ADD COLUMN     "chosen_target_id" TEXT,
ADD COLUMN     "closed_notice_at" TIMESTAMP(3),
ADD COLUMN     "reminder_alimtalk_at" TIMESTAMP(3),
ADD COLUMN     "stall_alerted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_notifications" ADD COLUMN     "quote_request_id" TEXT;

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "quote_request_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "source" "QuoteSource" NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "price_may_vary" BOOLEAN NOT NULL DEFAULT false,
    "similarity" "QuoteSimilarity" NOT NULL,
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "memo" VARCHAR(200),
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sender_seller_id" TEXT,
    "edited_at" TIMESTAMP(3),
    "consumer_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_target_id_key" ON "quotes"("target_id");

-- CreateIndex
CREATE INDEX "quotes_quote_request_id_created_at_idx" ON "quotes"("quote_request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_stores_link_token_key" ON "quote_request_stores"("link_token");

-- CreateIndex
CREATE INDEX "quote_request_stores_shop_id_idx" ON "quote_request_stores"("shop_id");

-- AddForeignKey
ALTER TABLE "quote_request_stores" ADD CONSTRAINT "quote_request_stores_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "quote_request_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "unentered" BOOLEAN NOT NULL DEFAULT false;

-- 이미 있는 방은 손님 목록에 그대로 보인다(만든 때부터)
UPDATE "chat_threads" SET "consumer_listed_at" = "created_at";
