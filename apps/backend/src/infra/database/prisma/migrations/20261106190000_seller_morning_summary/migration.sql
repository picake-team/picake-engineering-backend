-- 판매자 앱 아침 요약 알림(기획 I-48): 스토어별 켜고 끄기(기본 켬)와 보낸 날
ALTER TABLE "user_notification_preferences" ADD COLUMN "morning_summary_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_notification_preferences" ADD COLUMN "morning_summary_sent_on" TEXT;
