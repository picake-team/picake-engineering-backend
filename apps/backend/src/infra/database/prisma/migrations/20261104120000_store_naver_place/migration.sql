-- 스토어 네이버 플레이스 연결 컬럼 추가 (매장 정보 가져오기·갱신용)
ALTER TABLE "stores" ADD COLUMN "naver_place_id" TEXT,
ADD COLUMN "naver_place_connected_at" TIMESTAMP(3);
