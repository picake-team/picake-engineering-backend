-- 상품 카테고리 손보기(2026-11-15 저녁 운영자): 빈티지(VINTAGE)·입체(SCULPTED)를 없애고,
-- "모양" 묶음(하트·2단)은 디자인 묶음으로 합친다(묶음은 코드에만 있어 DB는 enum 값만 바뀜).
-- 상품에 붙어 있던 VINTAGE·SCULPTED는 지운다(옮길 비슷한 값이 없다). 서버는 요청에 오는 두 값을 조용히 뺀다.

BEGIN;

ALTER TABLE "products" ALTER COLUMN "product_category_types" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "product_category_types" TYPE text[] USING "product_category_types"::text[];

UPDATE "products"
SET "product_category_types" = array_remove(array_remove("product_category_types", 'VINTAGE'), 'SCULPTED')
WHERE "product_category_types" && ARRAY['VINTAGE', 'SCULPTED']::text[];

DROP TYPE "ProductCategoryType";
CREATE TYPE "ProductCategoryType" AS ENUM (
  'BIRTHDAY', 'COUPLE', 'THANKS', 'BABY', 'CONGRATS', 'WEDDING', 'SEASON',
  'LETTERING', 'DRAWING', 'PHOTO', 'CHARACTER', 'FLOWER', 'RIBBON', 'FRUIT', 'HEART', 'TWO_TIER', 'SIMPLE',
  'SAME_DAY_PICKUP'
);
ALTER TABLE "products" ALTER COLUMN "product_category_types" TYPE "ProductCategoryType"[] USING "product_category_types"::"ProductCategoryType"[];
ALTER TABLE "products" ALTER COLUMN "product_category_types" SET DEFAULT ARRAY[]::"ProductCategoryType"[];

COMMIT;
