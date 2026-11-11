-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('CONSUMER', 'SHOP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('TEXT', 'IMAGE', 'ORDER', 'PRODUCT');

-- CreateEnum
CREATE TYPE "ChatReportReason" AS ENUM ('ABUSE', 'SEXUAL', 'SPAM', 'FRAUD', 'OTHER');

-- CreateEnum
CREATE TYPE "ChatReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "admin_configs" ADD COLUMN     "chat_opens_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "consumer_notification_preferences" ADD COLUMN     "chat_push_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "user_notification_preferences" ADD COLUMN     "chat_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chat_quiet_night" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "store_id" TEXT,
    "kakao_place_id" TEXT,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" TEXT NOT NULL,
    "consumer_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "last_message_sender" "ChatSender",
    "last_message_preview" VARCHAR(80),
    "last_consumer_message_at" TIMESTAMP(3),
    "consumer_read_at" TIMESTAMP(3),
    "shop_read_at" TIMESTAMP(3),
    "consumer_seen_at" TIMESTAMP(3),
    "shop_seen_at" TIMESTAMP(3),
    "consumer_muted" BOOLEAN NOT NULL DEFAULT false,
    "shop_muted" BOOLEAN NOT NULL DEFAULT false,
    "blocked_by_consumer_at" TIMESTAMP(3),
    "blocked_by_shop_at" TIMESTAMP(3),
    "consumer_notified_at" TIMESTAMP(3),
    "shop_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "sender_seller_id" TEXT,
    "kind" "ChatMessageKind" NOT NULL,
    "text" TEXT,
    "masked_text" TEXT,
    "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ref_order_id" TEXT,
    "ref_product_id" TEXT,
    "card_snapshot" JSONB,
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_reports" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT,
    "reporter" "ChatSender" NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" "ChatReportReason" NOT NULL,
    "detail" VARCHAR(500),
    "status" "ChatReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" VARCHAR(200),
    "resolved_by_admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_rule_agreements" (
    "id" TEXT NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "agreed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rule_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_access_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_store_id_key" ON "shops"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "shops_kakao_place_id_key" ON "shops"("kakao_place_id");

-- CreateIndex
CREATE INDEX "chat_threads_consumer_id_last_message_at_idx" ON "chat_threads"("consumer_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "chat_threads_shop_id_last_message_at_idx" ON "chat_threads"("shop_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "chat_threads_last_message_at_idx" ON "chat_threads"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_threads_consumer_id_shop_id_key" ON "chat_threads"("consumer_id", "shop_id");

-- CreateIndex
CREATE INDEX "chat_messages_thread_id_created_at_idx" ON "chat_messages"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_thread_id_client_id_key" ON "chat_messages"("thread_id", "client_id");

-- CreateIndex
CREATE INDEX "chat_reports_status_created_at_idx" ON "chat_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "chat_reports_thread_id_idx" ON "chat_reports"("thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rule_agreements_actor_type_actor_id_version_key" ON "chat_rule_agreements"("actor_type", "actor_id", "version");

-- CreateIndex
CREATE INDEX "chat_access_logs_thread_id_idx" ON "chat_access_logs"("thread_id");

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_consumer_id_fkey" FOREIGN KEY ("consumer_id") REFERENCES "consumers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

