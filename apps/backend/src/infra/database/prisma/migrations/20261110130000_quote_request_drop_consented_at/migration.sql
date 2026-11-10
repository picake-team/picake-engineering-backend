-- 견적 요청의 가게 전달 동의 시각 칸을 지운다(동의 칸을 없앰).
ALTER TABLE "quote_requests" DROP COLUMN "consented_at";
