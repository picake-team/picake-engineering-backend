-- 맛 옵션을 따로 두지 않고 추가 옵션 '맛'(하나 고르기)으로 합친다
-- 1) 상품: cake_flavor_options가 있으면 custom_options 맨 앞에 '맛' 옵션을 넣는다
--    - 노출 중인 맛이 있으면 필수·노출(손님이 하나를 꼭 고름), 모두 숨김이면 숨김
--    - 맛 ID를 옵션값 ID로 그대로 써서, 진행 중인 주문의 옵션 변경에서도 같은 맛이 골라져 있다
--    - 옵션이 바뀌었으므로 options_version을 올리고, 옮긴 뒤 cake_flavor_options는 비운다
-- 2) 주문 항목: 고른 맛을 selected_options 맨 앞에 주문 시점 스냅샷으로 넣고 options_price에 맛 가격을 더한다
--    (item_price는 원래 맛 가격을 포함하므로 그대로)
-- 레거시 컬럼(products.cake_flavor_options, order_items.flavor_*)은 배포 중 구버전 서버가 읽을 수 있게 남기고 정리 단계에서 지운다

UPDATE "products" p
SET
  "custom_options" = jsonb_build_array(
    jsonb_build_object(
      'id', 'opt_flavor',
      'type', 'SINGLE_SELECT',
      'name', '맛',
      'required', f.has_visible,
      'visible', CASE WHEN f.has_visible THEN 'ENABLE' ELSE 'DISABLE' END,
      'choices', f.choices
    )
  ) || p."custom_options",
  "options_version" = p."options_version" + 1,
  "cake_flavor_options" = '[]'::jsonb
FROM (
  SELECT
    p2."id",
    bool_or(COALESCE(e.f ->> 'visible', 'ENABLE') = 'ENABLE') AS has_visible,
    jsonb_agg(
      jsonb_build_object(
        'id', COALESCE(NULLIF(e.f ->> 'id', ''), 'choice_flavor_' || e.ord),
        -- 옵션값 이름은 30자까지
        'label', left(btrim(e.f ->> 'displayName'), 30),
        'price', GREATEST(COALESCE((e.f ->> 'price')::numeric, 0), 0)::int,
        'visible', COALESCE(e.f ->> 'visible', 'ENABLE')
      )
      ORDER BY e.ord
    ) AS choices
  FROM "products" p2
  CROSS JOIN LATERAL jsonb_array_elements(p2."cake_flavor_options") WITH ORDINALITY AS e(f, ord)
  WHERE jsonb_typeof(p2."cake_flavor_options") = 'array'
    AND btrim(COALESCE(e.f ->> 'displayName', '')) <> ''
  GROUP BY p2."id"
) f
WHERE p."id" = f."id"
  -- 이미 '맛' 추가 옵션이 있으면 건너뛴다 (다시 실행해도 안전)
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p."custom_options") o WHERE o ->> 'id' = 'opt_flavor'
  );

-- 맛 이름이 모두 비어 있어 옮길 게 없던 상품도 레거시 값을 비운다
UPDATE "products"
SET "cake_flavor_options" = '[]'::jsonb
WHERE jsonb_typeof("cake_flavor_options") = 'array'
  AND jsonb_array_length("cake_flavor_options") > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements("cake_flavor_options") e
    WHERE btrim(COALESCE(e ->> 'displayName', '')) <> ''
  );

UPDATE "order_items" oi
SET
  "selected_options" = jsonb_build_array(
    jsonb_build_object(
      'optionId', 'opt_flavor',
      'type', 'SINGLE_SELECT',
      'name', '맛',
      'choices', jsonb_build_array(
        jsonb_build_object(
          'id', COALESCE(NULLIF(oi."flavor_id", ''), 'choice_flavor'),
          'label', oi."flavor_display_name",
          'price', COALESCE(oi."flavor_price", 0)
        )
      ),
      'price', COALESCE(oi."flavor_price", 0)
    )
  ) || oi."selected_options",
  "options_price" = oi."options_price" + COALESCE(oi."flavor_price", 0)
WHERE oi."flavor_display_name" IS NOT NULL
  AND btrim(oi."flavor_display_name") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(oi."selected_options") o WHERE o ->> 'optionId' = 'opt_flavor'
  );
