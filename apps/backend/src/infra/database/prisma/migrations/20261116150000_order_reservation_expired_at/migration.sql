-- 예약신청을 가게가 픽업 날이 지나도록 확인하지 않아 자동 취소한 시각(2026-11-16 운영자).
-- 답이 없는 예약신청이 영원히 "진행 중"으로 남아 손님이 탈퇴하지 못하던 것. 입금 마감 자동 취소(payment_pending_expired_at)와 같은 방식.
-- 열 하나를 더할 뿐이라 옛 서버와 함께 돌아도 된다.
ALTER TABLE "orders" ADD COLUMN "reservation_expired_at" TIMESTAMP(3);
