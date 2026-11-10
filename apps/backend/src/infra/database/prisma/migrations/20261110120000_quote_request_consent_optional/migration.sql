-- 견적 요청 가게 전달 동의 칸을 없앰(운영자 결정 2026-11-10). 동의 시각은 예전 요청에만 남는다.
ALTER TABLE "quote_requests" ALTER COLUMN "consented_at" DROP NOT NULL;
