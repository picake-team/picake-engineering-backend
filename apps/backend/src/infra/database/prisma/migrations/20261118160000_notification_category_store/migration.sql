-- 판매자 스토어 안내 알림 종류(정산 계좌가 바뀜 등, 2026-11-18). 값만 더하므로 옛 서버와 함께 돌아도 된다
-- (옛 서버의 판매자 알림 조회는 ORDER만 거르므로 STORE 행을 읽지 않는다).

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'STORE';
