-- CreateTable
CREATE TABLE "seller_fcm_tokens" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_fcm_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_fcm_tokens_token_key" ON "seller_fcm_tokens"("token");

-- CreateIndex
CREATE INDEX "seller_fcm_tokens_seller_id_idx" ON "seller_fcm_tokens"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_fcm_tokens_seller_id_device_id_key" ON "seller_fcm_tokens"("seller_id", "device_id");

-- AddForeignKey
ALTER TABLE "seller_fcm_tokens" ADD CONSTRAINT "seller_fcm_tokens_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

