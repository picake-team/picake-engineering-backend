-- 가입 때 "만 14세 이상" 확인 시각(법무 LG-02, 2026-11-26). 빈 칸으로 더해 기존 가입자는 null
ALTER TABLE "consumers" ADD COLUMN "age_confirmed_at" TIMESTAMP(3);
ALTER TABLE "sellers" ADD COLUMN "age_confirmed_at" TIMESTAMP(3);
