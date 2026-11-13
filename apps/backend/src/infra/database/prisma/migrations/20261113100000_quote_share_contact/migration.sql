-- 견적 요청을 보낼 때 "받는 가게에 이름·휴대폰 번호가 전달돼요" 안내를 보고 보냈는지(운영자 결정 2026-11-13).
-- 이 칸이 true인 요청만 가게 쪽(견적 링크·판매자 앱)에 손님 이름·휴대폰을 보여 준다. 전에 보낸 요청은 false로 남아 보이지 않는다.
ALTER TABLE "quote_requests" ADD COLUMN "share_contact" BOOLEAN NOT NULL DEFAULT false;
