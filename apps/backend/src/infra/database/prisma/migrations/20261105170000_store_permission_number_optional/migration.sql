-- 통신판매업 신고번호를 선택으로 바꾼다
-- 동네 가게가 근처 손님에게 음식료를 파는 거래는 전자상거래법 제3조 ④로 통신판매업 신고(제12조)가 적용되지 않아
-- 스토어 만들기에서 받지 않을 수 있다. 기존 값은 그대로 두고 NOT NULL만 푼다(구버전 서버는 늘 값을 넣으므로 배포 중에도 안전)
ALTER TABLE "stores" ALTER COLUMN "permission_management_number" DROP NOT NULL;
