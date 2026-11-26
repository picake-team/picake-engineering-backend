-- 판매자 애플 로그인(판매자 앱 App Store 심사 4.8) — 손님 애플 로그인과 같은 모양
ALTER TABLE "sellers" ADD COLUMN "apple_id" TEXT;
ALTER TABLE "sellers" ADD COLUMN "apple_email" TEXT;
-- 탈퇴 때 /auth/revoke 호출용 refresh_token (AES-256-GCM 암호화 저장)
ALTER TABLE "sellers" ADD COLUMN "apple_refresh_token" TEXT;

CREATE UNIQUE INDEX "sellers_apple_id_key" ON "sellers"("apple_id");
CREATE INDEX "sellers_apple_id_idx" ON "sellers"("apple_id");
