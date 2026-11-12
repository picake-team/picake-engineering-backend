-- 옛 채팅 정리(운영자 결정 2026-11-12): 새 채팅(chat_threads·chat_messages, 20261112000000_chat_v1)으로 바꾸며
-- 쓰지 않게 된 옛 표를 지운다. 옛 채팅은 화면에 들어가는 곳이 없어 손님·가게가 쓴 적이 없고, 코드는 이미 지웠다.
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "chat_rooms";
DROP TYPE IF EXISTS "MessageSenderType";
