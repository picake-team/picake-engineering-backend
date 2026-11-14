-- 케이크 디자인 모음(기획 I-112): 디자인은 웹에 있고(DB 아님) 손님은 디자인에 좋아요를 누르고, 고른 디자인으로 견적 요청서를 채운다.
-- 요청서 참고 사진마다 어느 디자인에서 왔는지·무엇을 따를지(photo_details, photo_urls와 같은 순서)와 고른 디자인 ID(design_ids)를 남기고,
-- 디자인 모음에서 연 요청서를 들어온 곳(DESIGN)으로 센다. 이전 요청은 photo_details가 []이고 읽을 때 사진마다 "손님 사진 · 전체"로 본다.
ALTER TYPE "QuoteRequestEntry" ADD VALUE 'DESIGN';

ALTER TABLE "quote_requests" ADD COLUMN "photo_details" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "design_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 디자인별 요청 수를 셀 때(design_ids @> ARRAY[...])
CREATE INDEX "quote_requests_design_ids_idx" ON "quote_requests" USING GIN ("design_ids");

CREATE TABLE "design_likes" (
    "id" TEXT NOT NULL,
    "consumer_id" TEXT NOT NULL,
    "design_id" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_likes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "design_likes_consumer_id_idx" ON "design_likes"("consumer_id");
CREATE INDEX "design_likes_design_id_idx" ON "design_likes"("design_id");
CREATE UNIQUE INDEX "design_likes_consumer_id_design_id_key" ON "design_likes"("consumer_id", "design_id");

ALTER TABLE "design_likes" ADD CONSTRAINT "design_likes_consumer_id_fkey" FOREIGN KEY ("consumer_id") REFERENCES "consumers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
