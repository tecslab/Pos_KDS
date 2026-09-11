BEGIN;

SET LOCAL statement_timeout = '60s';
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '69000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't069-reporter@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '69000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't069-observer@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name) VALUES
  ('69000000-0000-4000-8000-000000000003', 't069-reporter', 'T-069 Reporter'),
  ('69000000-0000-4000-8000-000000000004', 't069-observer', 'T-069 Observer');
INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('69000000-0000-4000-8000-000000000001', 'T-069 Reporter', true),
  ('69000000-0000-4000-8000-000000000002', 'T-069 Observer', true);
INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('69000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000003'),
  ('69000000-0000-4000-8000-000000000002', '69000000-0000-4000-8000-000000000004');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '69000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code IN (
  'reports.view', 'inventory.adjustments.register',
  'inventory.waste.register', 'inventory.purchases.register',
  'production.batch.create'
);

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES (
  '69000000-0000-4000-8000-000000000010',
  'T-069 Report Restaurant', true, '2026-09-01 05:00:00+00'
);
INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES (
  '69000000-0000-4000-8000-000000000010', 0, 5, 7, 6, 8,
  '{"allowNegativeStock": false}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  '2026-09-01 05:00:00+00'
);
INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '69000000-0000-4000-8000-000000000011',
  '69000000-0000-4000-8000-000000000010',
  'T-069 Table', 'TABLE', 0, true, false, '2026-09-01 05:00:00+00'
);

INSERT INTO public.expense_categories (
  id, restaurant_id, code, name, is_active, created_at, updated_at
) VALUES
  (
    '69000000-0000-4000-8000-000000000012',
    '69000000-0000-4000-8000-000000000010',
    'T069-INV', 'T-069 Purchase Snapshot', true,
    '2026-09-01 05:00:00+00', '2026-09-01 05:00:00+00'
  ),
  (
    '69000000-0000-4000-8000-000000000013',
    '69000000-0000-4000-8000-000000000010',
    'T069-UTIL', 'T-069 Utilities Snapshot', true,
    '2026-09-01 05:00:00+00', '2026-09-01 05:00:00+00'
  );

INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES
  (
    '69000000-0000-4000-8000-000000000020',
    '69000000-0000-4000-8000-000000000010',
    'T-069 Flour at Transaction', 'RAW_INGREDIENT', 'kg', 4, true,
    '2026-09-01 05:00:00+00'
  ),
  (
    '69000000-0000-4000-8000-000000000021',
    '69000000-0000-4000-8000-000000000010',
    'T-069 Dough at Transaction', 'PRODUCED_ITEM', 'unit', 1, true,
    '2026-09-01 05:00:00+00'
  );

INSERT INTO public.product_catalogs (restaurant_id, name, is_active, updated_at)
VALUES (
  '69000000-0000-4000-8000-000000000010',
  'T-069 Catalog', true, '2026-09-01 05:00:00+00'
);
INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '69000000-0000-4000-8000-000000000030',
  '69000000-0000-4000-8000-000000000010',
  'T-069 Prepared', 0, true, '2026-09-01 05:00:00+00'
);
INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES (
  '69000000-0000-4000-8000-000000000031',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000030', 0, true,
  '2026-09-01 05:00:00+00'
);
INSERT INTO public.recipes (
  id, restaurant_id, product_id, output_inventory_item_id,
  name, is_active, updated_at
) VALUES (
  '69000000-0000-4000-8000-000000000032',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000031',
  '69000000-0000-4000-8000-000000000021',
  'T-069 Dough Recipe at Transaction', true, '2026-09-01 05:00:00+00'
);
INSERT INTO public.recipe_versions (
  id, restaurant_id, recipe_id, version_number,
  produced_quantity, produced_unit, created_by_id, created_at
) VALUES (
  '69000000-0000-4000-8000-000000000033',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000032', 1, 2, 'unit',
  '69000000-0000-4000-8000-000000000001', '2026-09-01 05:00:00+00'
);
INSERT INTO public.recipe_ingredients (
  restaurant_id, recipe_version_id, inventory_item_id,
  required_quantity, unit_of_measure
) VALUES (
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000033',
  '69000000-0000-4000-8000-000000000020', 2, 'kg'
);

CREATE TEMP TABLE t069_clock AS
SELECT
  (transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date AS report_date,
  (transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date::timestamp
    AT TIME ZONE 'America/Guayaquil' AS day_start,
  ((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date + 1)::timestamp
    AT TIME ZONE 'America/Guayaquil' AS day_end;

-- Lower day boundary: 2026-09-09 00:00 America/Guayaquil = 05:00 UTC.
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '69000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000020',
  'ADJUSTMENT', '5', 'opening correction',
  transaction_timestamp(), NULL
);

CREATE TEMP TABLE t069_purchase AS
SELECT * FROM public.register_inventory_purchase(
  '69000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000012',
  'T-069 Supplier', 'T069-PURCHASE', 'report probe purchase',
  '[{"inventoryItemId":"69000000-0000-4000-8000-000000000020","quantity":"10.000","unitPrice":"2.00"}]',
  transaction_timestamp(), NULL
);
DROP TABLE pg_temp.inventory_purchase_input_lines;

CREATE TEMP TABLE t069_production AS
SELECT * FROM public.complete_production_batch(
  '69000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000033',
  '2', 'report probe production', transaction_timestamp(), NULL
);
DROP TABLE pg_temp.production_ingredient_requirements;

SELECT * FROM public.register_inventory_adjustment_or_waste(
  '69000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000020',
  'WASTE', '1', 'T-069 spoiled flour',
  transaction_timestamp(), NULL
);

INSERT INTO public.orders (
  id, restaurant_id, service_location_id, assigned_waiter_id,
  order_number, status, total_amount, created_at, updated_at
) VALUES (
  '69000000-0000-4000-8000-000000000040',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000011',
  '69000000-0000-4000-8000-000000000001',
  'T069-SALE', 'PENDING', 0,
  transaction_timestamp() - interval '2 seconds',
  transaction_timestamp() - interval '2 seconds'
);
INSERT INTO public.customer_baskets (
  id, restaurant_id, order_id, status, total_amount, created_at
) VALUES (
  '69000000-0000-4000-8000-000000000043',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000040', 'PENDING', 0,
  transaction_timestamp() - interval '2 seconds'
);
INSERT INTO public.inventory_movements (
  id, restaurant_id, inventory_item_id, type, quantity_delta,
  unit_of_measure, recorded_by_id, recorded_at,
  business_origin_type, business_origin_id, comments
) VALUES (
  '69000000-0000-4000-8000-000000000041',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000020',
  'SALE', -1, 'kg', '69000000-0000-4000-8000-000000000001',
  transaction_timestamp() - interval '1 second', 'SALE',
  '69000000-0000-4000-8000-000000000040', 'T-069 sale'
);
INSERT INTO public.inventory_movements (
  id, restaurant_id, inventory_item_id, type, quantity_delta,
  unit_of_measure, recorded_by_id, recorded_at,
  business_origin_type, business_origin_id, comments, reversed_movement_id
) VALUES (
  '69000000-0000-4000-8000-000000000042',
  '69000000-0000-4000-8000-000000000010',
  '69000000-0000-4000-8000-000000000020',
  'ROLLBACK', 1, 'kg', '69000000-0000-4000-8000-000000000001',
  transaction_timestamp(), 'ROLLBACK',
  '69000000-0000-4000-8000-000000000040', 'T-069 rollback',
  '69000000-0000-4000-8000-000000000041'
);

-- A prior local day, exact lower boundary, and exact upper boundary.
INSERT INTO public.operating_expenses (
  id, restaurant_id, expense_category_id, amount, description,
  incurred_at, recorded_at, recorded_by_id,
  expense_category_code, expense_category_name, origin_type
) VALUES
  (
    '69000000-0000-4000-8000-000000000050',
    '69000000-0000-4000-8000-000000000010',
    '69000000-0000-4000-8000-000000000013', 3.00,
    'month but not report day',
    (SELECT day_start - interval '2 days' FROM t069_clock),
    transaction_timestamp(), '69000000-0000-4000-8000-000000000001',
    'T069-UTIL', 'T-069 Utilities Snapshot', 'MANUAL'
  ),
  (
    '69000000-0000-4000-8000-000000000051',
    '69000000-0000-4000-8000-000000000010',
    '69000000-0000-4000-8000-000000000013', 100.00,
    'one second before local day',
    (SELECT day_start - interval '1 second' FROM t069_clock),
    transaction_timestamp(), '69000000-0000-4000-8000-000000000001',
    'T069-UTIL', 'T-069 Utilities Snapshot', 'MANUAL'
  ),
  (
    '69000000-0000-4000-8000-000000000052',
    '69000000-0000-4000-8000-000000000010',
    '69000000-0000-4000-8000-000000000013', 4.00,
    'exact local day start', (SELECT day_start FROM t069_clock),
    transaction_timestamp(), '69000000-0000-4000-8000-000000000001',
    'T069-UTIL', 'T-069 Utilities Snapshot', 'MANUAL'
  ),
  (
    '69000000-0000-4000-8000-000000000053',
    '69000000-0000-4000-8000-000000000010',
    '69000000-0000-4000-8000-000000000013', 200.00,
    'exact next local day start', (SELECT day_end FROM t069_clock),
    transaction_timestamp(), '69000000-0000-4000-8000-000000000001',
    'T069-UTIL', 'T-069 Utilities Snapshot', 'MANUAL'
  );

UPDATE public.inventory_items
SET name = CASE id
  WHEN '69000000-0000-4000-8000-000000000020'::uuid THEN 'T-069 Renamed Flour'
  ELSE 'T-069 Renamed Dough'
END,
updated_at = '2026-09-09 12:00:00+00'
WHERE restaurant_id = '69000000-0000-4000-8000-000000000010';
UPDATE public.recipes
SET name = 'T-069 Renamed Current Recipe', updated_at = '2026-09-09 12:00:00+00'
WHERE id = '69000000-0000-4000-8000-000000000032';

CREATE TEMP TABLE t069_counts_before AS
SELECT
  (SELECT count(*) FROM public.inventory_movements) AS movements,
  (SELECT count(*) FROM public.inventory_purchases) AS purchases,
  (SELECT count(*) FROM public.inventory_purchase_lines) AS purchase_lines,
  (SELECT count(*) FROM public.production_batches) AS production_batches,
  (SELECT count(*) FROM public.inventory_adjustments) AS adjustments,
  (SELECT count(*) FROM public.inventory_waste_records) AS waste_records,
  (SELECT count(*) FROM public.operating_expenses) AS expenses;

CREATE TEMP TABLE t069_report AS
SELECT * FROM public.read_inventory_production_expense_report(
  '69000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000010',
  (SELECT report_date FROM t069_clock), 'America/Guayaquil'
);

DO $probe$
DECLARE
  result_row record;
  before_row record;
  movement_types text[];
BEGIN
  SELECT * INTO result_row FROM t069_report;
  SELECT * INTO before_row FROM t069_counts_before;
  SELECT array_agg(value ->> 'type' ORDER BY value ->> 'type')
  INTO movement_types
  FROM jsonb_array_elements(result_row.movements) AS movement(value);

  IF result_row.restaurant_id IS DISTINCT FROM
      '69000000-0000-4000-8000-000000000010'::uuid
    OR result_row.period_start IS DISTINCT FROM (SELECT day_start FROM t069_clock)
    OR result_row.period_end IS DISTINCT FROM (SELECT day_end FROM t069_clock)
    OR result_row.daily_expense_total IS DISTINCT FROM '24.00'
    OR result_row.monthly_expense_total IS DISTINCT FROM '327.00'
    OR jsonb_array_length(result_row.expenses) <> 2
    OR result_row.expenses @> '[{"description":"one second before local day"}]'
    OR result_row.expenses @> '[{"description":"exact next local day start"}]'
    OR NOT result_row.expenses @> '[{"description":"exact local day start"}]'
    OR NOT result_row.monthly_expenses_by_day @> '[{"amount":"3.00"}]'
    OR NOT result_row.monthly_expenses_by_day @> '[{"amount":"100.00"}]'
    OR NOT result_row.monthly_expenses_by_day @> '[{"amount":"24.00"}]'
    OR NOT result_row.monthly_expenses_by_day @> '[{"amount":"200.00"}]' THEN
    RAISE EXCEPTION 'Guayaquil day/month expense boundaries or totals were incorrect';
  END IF;

  IF movement_types IS DISTINCT FROM ARRAY[
      'ADJUSTMENT', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_OUTPUT',
      'PURCHASE', 'ROLLBACK', 'SALE', 'WASTE'
    ]
    OR jsonb_array_length(result_row.purchases) <> 1
    OR jsonb_array_length(result_row.purchases->0->'lines') <> 1
    OR result_row.purchases->0->>'operating_expense_id'
      IS DISTINCT FROM (SELECT operating_expense_id::text FROM t069_purchase)
    OR result_row.purchases->0->'lines'->0->>'inventory_movement_id'
      IS DISTINCT FROM (SELECT lines->0->>'inventoryMovementId' FROM t069_purchase)
    OR jsonb_array_length(result_row.production_batches) <> 1
    OR result_row.production_batches->0->>'id'
      IS DISTINCT FROM (SELECT batch_id::text FROM t069_production)
    OR jsonb_array_length(result_row.waste_records) <> 1
    OR jsonb_array_length(result_row.adjustments) <> 1 THEN
    RAISE EXCEPTION 'persisted purchase, production, correction, or ledger origins were incomplete';
  END IF;

  IF result_row.movements @> '[{"inventory_item_name":"T-069 Renamed Flour"}]'
    OR result_row.purchases->0->'lines' @>
      '[{"inventory_item_name":"T-069 Renamed Flour"}]'
    OR result_row.adjustments @>
      '[{"inventory_item_name":"T-069 Renamed Flour"}]'
    OR result_row.waste_records @>
      '[{"inventory_item_name":"T-069 Renamed Flour"}]'
    OR result_row.production_batches @>
      '[{"recipe_name":"T-069 Renamed Current Recipe"}]'
    OR NOT result_row.movements @>
      '[{"inventory_item_name":"T-069 Flour at Transaction"}]'
    OR NOT result_row.production_batches @>
      '[{"recipe_name":"T-069 Dough Recipe at Transaction","output_inventory_item_name":"T-069 Dough at Transaction"}]' THEN
    RAISE EXCEPTION 'transaction-time inventory or production labels were not preserved';
  END IF;

  IF (SELECT count(*) FROM public.inventory_movements) <> before_row.movements
    OR (SELECT count(*) FROM public.inventory_purchases) <> before_row.purchases
    OR (SELECT count(*) FROM public.inventory_purchase_lines) <> before_row.purchase_lines
    OR (SELECT count(*) FROM public.production_batches) <> before_row.production_batches
    OR (SELECT count(*) FROM public.inventory_adjustments) <> before_row.adjustments
    OR (SELECT count(*) FROM public.inventory_waste_records) <> before_row.waste_records
    OR (SELECT count(*) FROM public.operating_expenses) <> before_row.expenses THEN
    RAISE EXCEPTION 'report unexpectedly mutated persisted data';
  END IF;

  BEGIN
    PERFORM * FROM public.read_inventory_production_expense_report(
      '69000000-0000-4000-8000-000000000002',
      '69000000-0000-4000-8000-000000000010',
      (SELECT report_date FROM t069_clock), 'America/Guayaquil'
    );
    RAISE EXCEPTION 'expected reports.view denial';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF has_function_privilege(
    'authenticated',
    'public.read_inventory_production_expense_report(uuid,uuid,date,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated retained direct report execution';
  END IF;
END;
$probe$;

ROLLBACK;
