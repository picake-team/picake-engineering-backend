-- 운영자가 가게 대신 입력하는 짧은 접속(기획 I-41): 세션·요청 기록 표와 상품·직접 적은 주문의 "운영자 입력" 칸.
-- 시각 칸은 DB 기본값 없이 서버가 UTC로 넣는다(DB 세션 시간대와 상관없게).

-- AlterTable
ALTER TABLE "manual_orders" ADD COLUMN     "created_by_admin_id" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "created_by_admin_id" TEXT;

-- CreateTable
CREATE TABLE "admin_act_as_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "admin_username" VARCHAR(40) NOT NULL,
    "seller_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "ended_by" VARCHAR(40),

    CONSTRAINT "admin_act_as_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_act_as_actions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "route" VARCHAR(160) NOT NULL,
    "target_id" VARCHAR(64),
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_act_as_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_act_as_sessions_code_hash_key" ON "admin_act_as_sessions"("code_hash");

-- CreateIndex
CREATE INDEX "admin_act_as_sessions_store_id_started_at_idx" ON "admin_act_as_sessions"("store_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "admin_act_as_sessions_admin_id_started_at_idx" ON "admin_act_as_sessions"("admin_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "admin_act_as_actions_session_id_created_at_idx" ON "admin_act_as_actions"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "admin_act_as_actions" ADD CONSTRAINT "admin_act_as_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "admin_act_as_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

