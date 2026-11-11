-- 채팅(기획 I-11)은 배포하면 바로 열린다(운영자 결정 2026-11-12). 관리자 "여는 시각" 설정을 없앤다.
ALTER TABLE "admin_configs" DROP COLUMN "chat_opens_at";
