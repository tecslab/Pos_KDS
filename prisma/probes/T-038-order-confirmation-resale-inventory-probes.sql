BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '38000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  't038-order-confirmation-probe@example.invalid',
  '',
  CURRENT_TIMESTAMP,
  '{}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO public.roles (id, code, name)
VALUES (
  '38000000-0000-4000-8000-000000000002',
  't038-order-confirmation-probe',
  'T-038 Order Confirmation Probe'
);

INSERT INTO public.permissions (id, code, name)
VALUES (
  '38000000-0000-4000-8000-000000000003',
  'orders.create',
  'Create Orders'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active)
VALUES (
  '38000000-0000-4000-8000-000000000001',
  'T-038 Probe User',
  true
);

INSERT INTO public.user_role_assignments (user_id, role_id)
VALUES (
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002'
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '38000000-0000-4000-8000-000000000002', id
FROM public.permissions
WHERE code = 'orders.create';

INSERT INTO public.restaurants (id, name, is_active, updated_at)
VALUES (
  '38000000-0000-4000-8000-000000000004',
  'T-038 Probe Restaurant',
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES (
  '38000000-0000-4000-8000-000000000004',
  0,
  5,
  7,
  6,
  8,
  '{"allowNegativeStock": false}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP
);

INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '38000000-0000-4000-8000-000000000005',
  '38000000-0000-4000-8000-000000000004',
  'T-038 Probe Counter',
  'COUNTER',
  0,
  true,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_tax_rates (
  id, restaurant_id, code, name, rate, is_active, updated_at
) VALUES (
  '38000000-0000-4000-8000-000000000006',
  '38000000-0000-4000-8000-000000000004',
  'T038',
  'T-038 Tax',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.product_catalogs (
  restaurant_id, name, is_active, updated_at
) VALUES (
  '38000000-0000-4000-8000-000000000004',
  'T-038 Probe Catalog',
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '38000000-0000-4000-8000-000000000007',
  '38000000-0000-4000-8000-000000000004',
  'T-038 Probe Category',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES
  (
    '38000000-0000-4000-8000-000000000008',
    '38000000-0000-4000-8000-000000000004',
    'T-038 Resale Item',
    'RESALE_ITEM',
    'each',
    0,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    '38000000-0000-4000-8000-000000000009',
    '38000000-0000-4000-8000-000000000004',
    'T-038 Raw Item',
    'RAW_INGREDIENT',
    'gram',
    0,
    true,
    CURRENT_TIMESTAMP
  );

INSERT INTO public.inventory_movements (
  id, restaurant_id, inventory_item_id, type, quantity_delta,
  unit_of_measure, recorded_by_id, recorded_at,
  business_origin_type, business_origin_id
) VALUES (
  '38000000-0000-4000-8000-000000000010',
  '38000000-0000-4000-8000-000000000004',
  '38000000-0000-4000-8000-000000000008',
  'PURCHASE',
  10,
  'each',
  '38000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP - INTERVAL '1 minute',
  'PURCHASE',
  '38000000-0000-4000-8000-000000000011'
);

INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES
  (
    '38000000-0000-4000-8000-000000000012',
    '38000000-0000-4000-8000-000000000004',
    '38000000-0000-4000-8000-000000000007',
    0,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    '38000000-0000-4000-8000-000000000013',
    '38000000-0000-4000-8000-000000000004',
    '38000000-0000-4000-8000-000000000007',
    1,
    true,
    CURRENT_TIMESTAMP
  );

INSERT INTO public.product_versions (
  id, restaurant_id, product_id, version_number, name, unit_price,
  printer_alias, tax_rate_id, tax_code, tax_name, tax_rate,
  price_includes_tax, resale_inventory_item_id
) VALUES
  (
    '38000000-0000-4000-8000-000000000014',
    '38000000-0000-4000-8000-000000000004',
    '38000000-0000-4000-8000-000000000012',
    1,
    'T-038 Bottled Drink',
    2.00,
    'T038-DRINK',
    '38000000-0000-4000-8000-000000000006',
    'T038',
    'T-038 Tax',
    0,
    true,
    '38000000-0000-4000-8000-000000000008'
  ),
  (
    '38000000-0000-4000-8000-000000000015',
    '38000000-0000-4000-8000-000000000004',
    '38000000-0000-4000-8000-000000000013',
    1,
    'T-038 Prepared Item',
    1.00,
    'T038-PREPARED',
    '38000000-0000-4000-8000-000000000006',
    'T038',
    'T-038 Tax',
    0,
    true,
    NULL
  );

DO $probe$
DECLARE
  first_order_id uuid;
  permitted_order_id uuid;
  before_rejection jsonb;
  after_rejection jsonb;
BEGIN
  SELECT confirmation.order_id
  INTO first_order_id
  FROM public.confirm_order(
    '38000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000005',
    NULL,
    jsonb_build_array(
      jsonb_build_object(
        'clientCorrelationId', 't038-first-a',
        'lines', jsonb_build_array(
          jsonb_build_object(
            'productVersionId', '38000000-0000-4000-8000-000000000014',
            'quantity', 2,
            'optionIds', jsonb_build_array(),
            'removableIngredientIds', jsonb_build_array(),
            'observations', NULL
          ),
          jsonb_build_object(
            'productVersionId', '38000000-0000-4000-8000-000000000015',
            'quantity', 4,
            'optionIds', jsonb_build_array(),
            'removableIngredientIds', jsonb_build_array(),
            'observations', NULL
          )
        )
      ),
      jsonb_build_object(
        'clientCorrelationId', 't038-first-b',
        'lines', jsonb_build_array(
          jsonb_build_object(
            'productVersionId', '38000000-0000-4000-8000-000000000014',
            'quantity', 3,
            'optionIds', jsonb_build_array(),
            'removableIngredientIds', jsonb_build_array(),
            'observations', NULL
          )
        )
      )
    )::text,
    CURRENT_TIMESTAMP,
    '192.0.2.38'
  ) AS confirmation;

  IF first_order_id IS NULL THEN
    RAISE EXCEPTION 'positive probe failed: confirmation returned no order';
  END IF;

  IF (SELECT count(*) FROM public.inventory_movements
      WHERE business_origin_type = 'SALE' AND business_origin_id = first_order_id) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.inventory_movements
      WHERE business_origin_type = 'SALE'
        AND business_origin_id = first_order_id
        AND inventory_item_id = '38000000-0000-4000-8000-000000000008'
        AND type = 'SALE'
        AND quantity_delta = -5
        AND unit_of_measure = 'each'
        AND recorded_by_id = '38000000-0000-4000-8000-000000000001'
        AND reversed_movement_id IS NULL
    ) THEN
    RAISE EXCEPTION 'positive probe failed: resale quantities were not aggregated into one canonical movement';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements
    WHERE business_origin_type = 'SALE'
      AND business_origin_id = first_order_id
      AND inventory_item_id = '38000000-0000-4000-8000-000000000009'
  ) THEN
    RAISE EXCEPTION 'scope probe failed: a raw or source-less product consumed inventory';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.audit_events AS audit
    JOIN public.inventory_movements AS movement
      ON movement.id::text = audit.entity_id
    WHERE movement.business_origin_type = 'SALE'
      AND movement.business_origin_id = first_order_id
      AND audit.action = 'inventory_movement.sale_recorded'
      AND audit.entity_type = 'inventory_movement'
      AND audit.previous_values IS NULL
      AND audit.new_values ->> 'businessOriginId' = first_order_id::text
      AND (audit.new_values ->> 'quantityDelta')::numeric = -5
      AND jsonb_array_length(audit.new_values -> 'saleSnapshotIds') = 2
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(audit.new_values -> 'saleSnapshotIds') AS snapshot(id)
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.order_line_sale_snapshots AS sale_snapshot
          JOIN public.order_lines AS order_line
            ON order_line.restaurant_id = sale_snapshot.restaurant_id
           AND order_line.id = sale_snapshot.order_line_id
          JOIN public.customer_baskets AS basket
            ON basket.restaurant_id = order_line.restaurant_id
           AND basket.id = order_line.basket_id
          WHERE sale_snapshot.id = snapshot.id::uuid
            AND sale_snapshot.product_version_id = '38000000-0000-4000-8000-000000000014'
            AND basket.order_id = first_order_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'audit probe failed: movement audit or snapshot provenance is incomplete';
  END IF;

  EXECUTE 'DROP TABLE pg_temp.order_confirmation_lines';
  EXECUTE 'DROP TABLE pg_temp.order_confirmation_resale_movements';

  SELECT jsonb_build_array(
    (SELECT count(*) FROM public.orders),
    (SELECT count(*) FROM public.customer_baskets),
    (SELECT count(*) FROM public.order_lines),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.inventory_movements),
    (SELECT count(*) FROM public.audit_events)
  ) INTO before_rejection;

  BEGIN
    PERFORM *
    FROM public.confirm_order(
      '38000000-0000-4000-8000-000000000001',
      '38000000-0000-4000-8000-000000000005',
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'clientCorrelationId', 't038-rejected',
          'lines', jsonb_build_array(
            jsonb_build_object(
              'productVersionId', '38000000-0000-4000-8000-000000000014',
              'quantity', 6,
              'optionIds', jsonb_build_array(),
              'removableIngredientIds', jsonb_build_array(),
              'observations', NULL
            )
          )
        )
      )::text,
      CURRENT_TIMESTAMP,
      NULL
    );
    RAISE EXCEPTION 'negative probe failed: insufficient inventory was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ORDER_CONFIRMATION_INSUFFICIENT_INVENTORY' THEN
      RAISE;
    END IF;
  END;

  SELECT jsonb_build_array(
    (SELECT count(*) FROM public.orders),
    (SELECT count(*) FROM public.customer_baskets),
    (SELECT count(*) FROM public.order_lines),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.inventory_movements),
    (SELECT count(*) FROM public.audit_events)
  ) INTO after_rejection;

  IF after_rejection IS DISTINCT FROM before_rejection THEN
    RAISE EXCEPTION 'atomicity probe failed: rejected confirmation persisted partial state';
  END IF;

  EXECUTE 'DROP TABLE IF EXISTS pg_temp.order_confirmation_lines';
  EXECUTE 'DROP TABLE IF EXISTS pg_temp.order_confirmation_resale_movements';

  UPDATE public.restaurant_configurations
  SET inventory_policy = jsonb_set(inventory_policy, '{allowNegativeStock}', 'true'::jsonb),
      updated_at = CURRENT_TIMESTAMP
  WHERE restaurant_id = '38000000-0000-4000-8000-000000000004';

  SELECT confirmation.order_id
  INTO permitted_order_id
  FROM public.confirm_order(
    '38000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000005',
    NULL,
    jsonb_build_array(
      jsonb_build_object(
        'clientCorrelationId', 't038-permitted',
        'lines', jsonb_build_array(
          jsonb_build_object(
            'productVersionId', '38000000-0000-4000-8000-000000000014',
            'quantity', 6,
            'optionIds', jsonb_build_array(),
            'removableIngredientIds', jsonb_build_array(),
            'observations', NULL
          )
        )
      )
    )::text,
    CURRENT_TIMESTAMP,
    NULL
  ) AS confirmation;

  IF permitted_order_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.inventory_movements
      WHERE business_origin_type = 'SALE'
        AND business_origin_id = permitted_order_id
        AND inventory_item_id = '38000000-0000-4000-8000-000000000008'
        AND quantity_delta = -6
    )
    OR (SELECT current_balance
        FROM public.inventory_balances
        WHERE restaurant_id = '38000000-0000-4000-8000-000000000004'
          AND inventory_item_id = '38000000-0000-4000-8000-000000000008') <> -1 THEN
    RAISE EXCEPTION 'policy probe failed: configured negative stock was not permitted and recorded';
  END IF;
END;
$probe$;

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
