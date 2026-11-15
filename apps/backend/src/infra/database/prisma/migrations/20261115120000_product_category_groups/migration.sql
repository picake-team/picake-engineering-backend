-- 상품 카테고리 다시 나누기(2026-11-15): 질문 하나에 묶음 하나
-- 상황: 생일·연인·기념일·부모님·감사·백일·돌·축하·결혼·프로포즈·시즌
-- 디자인: 레터링·드로잉·사진·캐릭터·꽃·리본·과일·빈티지·심플
-- 모양: 하트·입체·2단 / 서비스: 당일픽업
--
-- 옛 값 옮기기(서버 LEGACY_PRODUCT_CATEGORY_MAP과 같은 규칙):
--   LOVER(연인)·ANNIVERSARY(기념일) → COUPLE(연인·기념일)
--   FAMILY(가족) → THANKS(부모님·감사)
--   FRIEND(친구) → BIRTHDAY(생일)  — 새 분류에 "친구"는 없고, 친구 케이크는 대부분 생일
-- LETTERING은 값 그대로 두고 뜻만 "커스텀"(상품 유형과 자동 연결)에서 "레터링"(사장님이 고르는 디자인)으로 바뀐다.
-- 순서는 처음 나온 자리를 지키고, 옮기며 겹친 값은 하나만 남긴다.

BEGIN;

-- 1) 기본값을 잠시 빼고 글자 배열로 바꾼 뒤 옛 값을 옮긴다(USING 안에는 하위 쿼리를 못 써서 나눈다)
ALTER TABLE "products" ALTER COLUMN "product_category_types" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "product_category_types" TYPE text[] USING "product_category_types"::text[];

UPDATE "products"
SET "product_category_types" = ARRAY(
  SELECT m.v
  FROM (
    SELECT DISTINCT ON (x.v) x.v, x.ord
    FROM (
      SELECT
        CASE t.val
          WHEN 'LOVER' THEN 'COUPLE'
          WHEN 'ANNIVERSARY' THEN 'COUPLE'
          WHEN 'FAMILY' THEN 'THANKS'
          WHEN 'FRIEND' THEN 'BIRTHDAY'
          ELSE t.val
        END AS v,
        t.ord
      FROM unnest("product_category_types") WITH ORDINALITY AS t(val, ord)
    ) x
    ORDER BY x.v, x.ord
  ) m
  ORDER BY m.ord
)
WHERE "product_category_types" && ARRAY['LOVER', 'ANNIVERSARY', 'FAMILY', 'FRIEND']::text[];

-- 2) 새 enum으로 바꾼다(옛 값이 남아 있으면 여기서 실패해 전체가 되돌아간다)
DROP TYPE "ProductCategoryType";
CREATE TYPE "ProductCategoryType" AS ENUM (
  'BIRTHDAY', 'COUPLE', 'THANKS', 'BABY', 'CONGRATS', 'WEDDING', 'SEASON',
  'LETTERING', 'DRAWING', 'PHOTO', 'CHARACTER', 'FLOWER', 'RIBBON', 'FRUIT', 'VINTAGE', 'SIMPLE',
  'HEART', 'SCULPTED', 'TWO_TIER',
  'SAME_DAY_PICKUP'
);
ALTER TABLE "products" ALTER COLUMN "product_category_types" TYPE "ProductCategoryType"[] USING "product_category_types"::"ProductCategoryType"[];
ALTER TABLE "products" ALTER COLUMN "product_category_types" SET DEFAULT ARRAY[]::"ProductCategoryType"[];

COMMIT;
