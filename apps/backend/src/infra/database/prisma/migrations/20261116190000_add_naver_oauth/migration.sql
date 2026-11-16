-- 네이버 로그인(손님·사장님) — googleId/kakaoId와 같은 모양. 손님·사장님이 네이버 앱 하나를 같이 써서 같은 사람의 naver_id가 같다
ALTER TABLE "consumers" ADD COLUMN "naver_id" TEXT;
-- 탈퇴 때 네이버 연결 끊기(토큰 폐기)용 갱신 토큰(AES-256-GCM 암호화 저장)
ALTER TABLE "consumers" ADD COLUMN "naver_refresh_token" TEXT;
CREATE UNIQUE INDEX "consumers_naver_id_key" ON "consumers" ("naver_id");
CREATE INDEX "consumers_naver_id_idx" ON "consumers" ("naver_id");

ALTER TABLE "sellers" ADD COLUMN "naver_id" TEXT;
ALTER TABLE "sellers" ADD COLUMN "naver_refresh_token" TEXT;
CREATE UNIQUE INDEX "sellers_naver_id_key" ON "sellers" ("naver_id");
CREATE INDEX "sellers_naver_id_idx" ON "sellers" ("naver_id");
