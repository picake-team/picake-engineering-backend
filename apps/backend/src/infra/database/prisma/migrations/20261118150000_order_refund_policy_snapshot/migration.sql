-- 예약할 때의 가게 환불·취소 규정을 주문에 남긴다(2026-11-18). 예약 뒤 가게가 규정을 바꾸면 손님 주문 상세·취소 화면에도
-- 바뀐 규정이 보여, 손님이 예약할 때 본 규정과 달라졌다. 칸만 더하는 것이라 옛 서버와 함께 돌아도 된다.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "refund_cancellation_policy" JSONB;

-- 이미 있는 예약은 지금 가게 규정으로 채운다(예약 때 규정은 남아 있지 않다 — 지금 손님에게 보이는 규정과 같고, 이제부터는 바뀌지 않는다)
UPDATE "orders" AS o
SET "refund_cancellation_policy" = s."refund_cancellation_policy"
FROM "stores" AS s
WHERE s."id" = o."store_id" AND o."refund_cancellation_policy" IS NULL;
