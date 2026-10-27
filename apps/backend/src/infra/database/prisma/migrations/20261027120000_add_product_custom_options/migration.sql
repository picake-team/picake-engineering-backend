-- 상품 추가 옵션(커스텀 옵션) 도입
-- 1) 컬럼 추가: products.custom_options / options_version, order_items.selected_options / options_price
-- 2) 레거시 레터링·이미지 등록 설정을 추가 옵션(직접입력형·사진첨부형)으로 변환
-- 3) 카테고리 '커스텀'(LETTERING)을 상품 유형과 일치시킴 (상품 유형은 그대로 유지)
-- 4) 기존 주문 항목의 레터링·참고사진을 selected_options로 복사 (레거시 컬럼은 정리 단계까지 유지)

-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "custom_options" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "options_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "selected_options" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "options_price" INTEGER NOT NULL DEFAULT 0;

-- 레터링 사용 → 직접입력형 '레터링 문구'(필수), 이미지 등록 사용 → 사진첨부형 '참고사진'(필수, 최대 3장)
-- 기존 web-user 동작(레터링 필수, 커스텀 케이크는 사진 필수)과 같게 맞춘다.
UPDATE "products" p
SET "custom_options" = (
  SELECT COALESCE(jsonb_agg(s.o ORDER BY s.ord), '[]'::jsonb)
  FROM (
    SELECT 1 AS ord, jsonb_build_object(
      'id', 'opt_lettering',
      'type', 'TEXT',
      'name', '레터링 문구',
      'required', true,
      'visible', 'ENABLE',
      -- 0 이하는 설정 누락으로 보고 기본 20자, 상한은 직접입력형 최대치(100자)
      'maxLength', CASE
        WHEN p."lettering_max_length" < 1 THEN 20
        ELSE LEAST(p."lettering_max_length", 100)
      END,
      'placeholder', '케이크에 들어갈 문구를 적어주세요.'
    ) AS o
    WHERE p."lettering_visible"::text = 'ENABLE'
    UNION ALL
    SELECT 2 AS ord, jsonb_build_object(
      'id', 'opt_image',
      'type', 'IMAGE',
      'name', '참고사진',
      'required', true,
      'visible', 'ENABLE',
      'maxCount', 3
    ) AS o
    WHERE p."image_upload_enabled"::text = 'ENABLE'
  ) s
)
WHERE p."custom_options" = '[]'::jsonb;

-- 카테고리 '커스텀'은 상품 유형을 따라간다 (검색·지도 필터와 스토어 상세 탭 결과를 일치)
-- 상품 유형은 바꾸지 않는다: 스토어 상세 기본/커스텀 탭이 상품 유형 기준이라, 바꾸면 구매자가 보던 탭이 달라진다.
-- (운영에는 카테고리를 전부 체크해 '커스텀'이 들어간 기본 케이크가 있어, 카테고리 기준으로 바꾸면 기본 탭이 비게 됨)
UPDATE "products"
SET "product_category_types" = array_remove("product_category_types", 'LETTERING'::"ProductCategoryType")
WHERE "product_type"::text = 'BASIC_CAKE'
  AND 'LETTERING'::"ProductCategoryType" = ANY(COALESCE("product_category_types", ARRAY[]::"ProductCategoryType"[]));

UPDATE "products"
SET "product_category_types" = array_append(
  COALESCE("product_category_types", ARRAY[]::"ProductCategoryType"[]),
  'LETTERING'::"ProductCategoryType"
)
WHERE "product_type"::text = 'CUSTOM_CAKE'
  AND NOT ('LETTERING'::"ProductCategoryType" = ANY(COALESCE("product_category_types", ARRAY[]::"ProductCategoryType"[])));

-- 기존 주문 항목: 레터링·참고사진을 주문 시점 스냅샷 형태로 복사
UPDATE "order_items" oi
SET "selected_options" = (
  SELECT COALESCE(jsonb_agg(s.o ORDER BY s.ord), '[]'::jsonb)
  FROM (
    SELECT 1 AS ord, jsonb_build_object(
      'optionId', 'opt_lettering',
      'type', 'TEXT',
      'name', '레터링 문구',
      'text', oi."lettering_message",
      'price', 0
    ) AS o
    WHERE oi."lettering_message" IS NOT NULL AND btrim(oi."lettering_message") <> ''
    UNION ALL
    SELECT 2 AS ord, jsonb_build_object(
      'optionId', 'opt_image',
      'type', 'IMAGE',
      'name', '참고사진',
      'imageUrls', to_jsonb(oi."image_urls"),
      'price', 0
    ) AS o
    WHERE cardinality(oi."image_urls") > 0
  ) s
)
WHERE oi."selected_options" = '[]'::jsonb
  AND (
    (oi."lettering_message" IS NOT NULL AND btrim(oi."lettering_message") <> '')
    OR cardinality(oi."image_urls") > 0
  );
