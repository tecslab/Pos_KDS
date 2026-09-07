BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '58000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't058-authorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '58000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't058-unauthorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name) VALUES
  ('58000000-0000-4000-8000-000000000003', 't058-purchaser', 'T-058 Purchaser'),
  ('58000000-0000-4000-8000-000000000004', 't058-observer', 'T-058 Observer');

INSERT INTO public.permissions (id, code, name)
VALUES (
  '58000000-0000-4000-8000-000000000005',
  'inventory.purchases.register',
  'Register Purchases'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('58000000-0000-4000-8000-000000000001', 'T-058 Purchaser', true),
  ('58000000-0000-4000-8000-000000000002', 'T-058 Observer', true);
INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('58000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000003'),
  ('58000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000004');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '58000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code = 'inventory.purchases.register';

INSERT INTO public.restaurants (id, name, is_active, updated_at)
VALUES
  (
    '58000000-0000-4000-8000-000000000006',
    'T-058 Probe Restaurant', true, transaction_timestamp()
  ),
  (
    '58000000-0000-4000-8000-000000000010',
    'T-058 Other Restaurant', true, transaction_timestamp()
  );
INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES
  (
    '58000000-0000-4000-8000-000000000006', 0, 5, 7, 6, 8,
    '{"allowNegativeStock": false}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    transaction_timestamp()
  ),
  (
    '58000000-0000-4000-8000-000000000010', 0, 5, 7, 6, 8,
    '{"allowNegativeStock": false}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    transaction_timestamp()
  );
INSERT INTO public.expense_categories (
  id, restaurant_id, code, name, is_active, updated_at
) VALUES
  (
    '58000000-0000-4000-8000-000000000007',
    '58000000-0000-4000-8000-000000000006',
    't058_inventory', 'T-058 Inventory Purchases', true,
    transaction_timestamp()
  ),
  (
    '58000000-0000-4000-8000-000000000011',
    '58000000-0000-4000-8000-000000000010',
    't058_other', 'T-058 Other Purchases', true,
    transaction_timestamp()
  ),
  (
    '58000000-0000-4000-8000-000000000013',
    '58000000-0000-4000-8000-000000000006',
    't058_inactive', 'T-058 Inactive Category', false,
    transaction_timestamp()
  );
INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES
  (
    '58000000-0000-4000-8000-000000000008',
    '58000000-0000-4000-8000-000000000006',
    'T-058 Flour', 'RAW_INGREDIENT', 'kg', 2, true,
    transaction_timestamp()
  ),
  (
    '58000000-0000-4000-8000-000000000009',
    '58000000-0000-4000-8000-000000000006',
    'T-058 Bottled Drink', 'RESALE_ITEM', 'unit', 4, true,
    transaction_timestamp()
  ),
  (
    '58000000-0000-4000-8000-000000000012',
    '58000000-0000-4000-8000-000000000010',
    'T-058 Other Flour', 'RAW_INGREDIENT', 'kg', 2, true,
    transaction_timestamp()
  ),
  (
    '58000000-0000-4000-8000-000000000014',
    '58000000-0000-4000-8000-000000000006',
    'T-058 Inactive Flour', 'RAW_INGREDIENT', 'kg', 2, false,
    transaction_timestamp()
  );

CREATE TEMP TABLE t058_purchase_result AS
SELECT * FROM public.register_inventory_purchase(
  '58000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000006',
  '58000000-0000-4000-8000-000000000007',
  ' Mercado   Central ', ' FAC-058 ', ' weekly   delivery ',
  '[{"inventoryItemId":"58000000-0000-4000-8000-000000000008","quantity":"2.500","unitPrice":"4.94"},{"inventoryItemId":"58000000-0000-4000-8000-000000000009","quantity":"3","unitPrice":"1.25"}]',
  transaction_timestamp(), '192.0.2.58'
);
DROP TABLE pg_temp.inventory_purchase_input_lines;

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $probe$
DECLARE
  result_row record;
BEGIN
  SELECT * INTO result_row FROM t058_purchase_result;
  IF result_row.total_amount <> 16.10
    OR result_row.supplier_name_result <> 'Mercado Central'
    OR result_row.reference_number <> 'FAC-058'
    OR result_row.comments <> 'weekly delivery'
    OR jsonb_array_length(result_row.lines) <> 2
    OR (SELECT count(*) FROM public.inventory_purchases WHERE id = result_row.purchase_id) <> 1
    OR (SELECT count(*) FROM public.inventory_purchase_lines WHERE purchase_id = result_row.purchase_id) <> 2
    OR (SELECT count(*) FROM public.inventory_movements
        WHERE business_origin_type = 'PURCHASE' AND business_origin_id = result_row.purchase_id) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM public.operating_expenses
      WHERE id = result_row.operating_expense_id
        AND amount = 16.10
        AND reference_number = 'FAC-058'
        AND comments = 'weekly delivery'
        AND expense_category_code = 't058_inventory'
        AND expense_category_name = 'T-058 Inventory Purchases'
        AND origin_type = 'PURCHASE'
        AND origin_id = result_row.purchase_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE action = 'inventory_purchase.registered'
        AND entity_id = result_row.purchase_id::text
        AND actor_id = '58000000-0000-4000-8000-000000000001'
        AND new_values ->> 'operatingExpenseId' = result_row.operating_expense_id::text
        AND (new_values ->> 'totalAmount')::numeric = 16.10
        AND jsonb_array_length(new_values -> 'lines') = 2
    ) THEN
    RAISE EXCEPTION 'purchase did not create exact atomic records';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE business_origin_id = result_row.purchase_id
      AND inventory_item_id = '58000000-0000-4000-8000-000000000008'
      AND type = 'PURCHASE'
      AND quantity_delta = 2.500
      AND unit_of_measure = 'kg'
      AND comments = 'weekly delivery'
  ) THEN
    RAISE EXCEPTION 'purchase movement reference is incomplete';
  END IF;

  BEGIN
    INSERT INTO public.inventory_movements (
      restaurant_id, inventory_item_id, type, quantity_delta,
      unit_of_measure, recorded_by_id, recorded_at,
      business_origin_type, business_origin_id, comments
    ) VALUES (
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000008',
      'PURCHASE', 1, 'kg',
      '58000000-0000-4000-8000-000000000001',
      result_row.recorded_at, 'PURCHASE', result_row.purchase_id,
      'weekly delivery'
    );
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'additional purchase-origin movement was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%movement origin is not exclusive%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.inventory_movements
      WHERE business_origin_type = 'PURCHASE'
        AND business_origin_id = result_row.purchase_id) <> 2 THEN
    RAISE EXCEPTION 'rejected additional movement left residual state';
  END IF;

  BEGIN
    INSERT INTO public.operating_expenses (
      id, restaurant_id, expense_category_id, amount, description,
      incurred_at, recorded_at, recorded_by_id,
      expense_category_code, expense_category_name, origin_type, origin_id
    ) VALUES (
      '58000000-0000-4000-8000-000000000015',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000007',
      1, 'Invalid second purchase expense', result_row.recorded_at,
      result_row.recorded_at, '58000000-0000-4000-8000-000000000001',
      't058_inventory', 'T-058 Inventory Purchases',
      'PURCHASE', result_row.purchase_id
    );
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'additional purchase-origin expense was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%expense origin is not exclusive%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.operating_expenses
      WHERE origin_type = 'PURCHASE'
        AND origin_id = result_row.purchase_id) <> 1 THEN
    RAISE EXCEPTION 'rejected additional expense left residual state';
  END IF;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000002',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000007',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000008","quantity":"1","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'unauthorized purchase was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.inventory_purchases SET total_amount = 1
    WHERE id = result_row.purchase_id;
    RAISE EXCEPTION 'inventory purchase history mutation was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM NOT LIKE '%inventory_purchases history is immutable%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.inventory_purchase_lines SET quantity = 1
    WHERE purchase_id = result_row.purchase_id;
    RAISE EXCEPTION 'inventory purchase history mutation was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM NOT LIKE '%inventory_purchase_lines history is immutable%' THEN RAISE; END IF;
  END;
END;
$probe$;

DO $probe$
DECLARE
  purchases_before bigint;
  lines_before bigint;
  movements_before bigint;
  expenses_before bigint;
  audits_before bigint;
BEGIN
  SELECT count(*) INTO purchases_before FROM public.inventory_purchases;
  SELECT count(*) INTO lines_before FROM public.inventory_purchase_lines;
  SELECT count(*) INTO movements_before FROM public.inventory_movements;
  SELECT count(*) INTO expenses_before FROM public.operating_expenses;
  SELECT count(*) INTO audits_before FROM public.audit_events;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000011',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000008","quantity":"1","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'cross-tenant category was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_PURCHASE_CATEGORY_UNAVAILABLE%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000013',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000008","quantity":"1","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'inactive category was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_PURCHASE_CATEGORY_UNAVAILABLE%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000099',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000008","quantity":"1","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'missing category was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_PURCHASE_CATEGORY_UNAVAILABLE%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000007',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000012","quantity":"1","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'cross-tenant item was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_PURCHASE_ITEM_UNAVAILABLE%' THEN RAISE; END IF;
  END;
  DROP TABLE IF EXISTS pg_temp.inventory_purchase_input_lines;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000007',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000014","quantity":"1","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'inactive item was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_PURCHASE_ITEM_UNAVAILABLE%' THEN RAISE; END IF;
  END;
  DROP TABLE IF EXISTS pg_temp.inventory_purchase_input_lines;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000007',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000099","quantity":"1","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'missing item was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_PURCHASE_ITEM_UNAVAILABLE%' THEN RAISE; END IF;
  END;
  DROP TABLE IF EXISTS pg_temp.inventory_purchase_input_lines;

  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000007',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000008","quantity":"1.0000","unitPrice":"1"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'malformed numeric purchase was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  DROP TABLE IF EXISTS pg_temp.inventory_purchase_input_lines;

  IF (SELECT count(*) FROM public.inventory_purchases) <> purchases_before
    OR (SELECT count(*) FROM public.inventory_purchase_lines) <> lines_before
    OR (SELECT count(*) FROM public.inventory_movements) <> movements_before
    OR (SELECT count(*) FROM public.operating_expenses) <> expenses_before
    OR (SELECT count(*) FROM public.audit_events) <> audits_before THEN
    RAISE EXCEPTION 'validation rejection left residual purchase records';
  END IF;
END;
$probe$;

CREATE FUNCTION pg_temp.reject_t058_purchase_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'inventory_purchase.registered' THEN
    RAISE EXCEPTION 'T058_FORCED_AUDIT_FAILURE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER t058_force_purchase_audit_failure
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_t058_purchase_audit();

DO $probe$
DECLARE
  purchases_before bigint;
  lines_before bigint;
  movements_before bigint;
  expenses_before bigint;
BEGIN
  SELECT count(*) INTO purchases_before FROM public.inventory_purchases;
  SELECT count(*) INTO lines_before FROM public.inventory_purchase_lines;
  SELECT count(*) INTO movements_before FROM public.inventory_movements;
  SELECT count(*) INTO expenses_before FROM public.operating_expenses;
  BEGIN
    PERFORM * FROM public.register_inventory_purchase(
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000006',
      '58000000-0000-4000-8000-000000000007',
      NULL, NULL, NULL,
      '[{"inventoryItemId":"58000000-0000-4000-8000-000000000008","quantity":"1","unitPrice":"2"}]',
      transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'forced audit failure did not abort inventory purchase';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%T058_FORCED_AUDIT_FAILURE%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.inventory_purchases) <> purchases_before
    OR (SELECT count(*) FROM public.inventory_purchase_lines) <> lines_before
    OR (SELECT count(*) FROM public.inventory_movements) <> movements_before
    OR (SELECT count(*) FROM public.operating_expenses) <> expenses_before THEN
    RAISE EXCEPTION 'invalid purchase left partial state';
  END IF;
END;
$probe$;

ROLLBACK;
