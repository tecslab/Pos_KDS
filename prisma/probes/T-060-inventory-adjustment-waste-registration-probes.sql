BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('60000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 't060-adjuster@example.invalid', '', CURRENT_TIMESTAMP, '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('60000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 't060-waste@example.invalid', '', CURRENT_TIMESTAMP, '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('60000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 't060-observer@example.invalid', '', CURRENT_TIMESTAMP, '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO public.roles (id, code, name) VALUES
  ('60000000-0000-4000-8000-000000000004', 't060-adjuster', 'T-060 Adjuster'),
  ('60000000-0000-4000-8000-000000000005', 't060-waste-recorder', 'T-060 Waste Recorder'),
  ('60000000-0000-4000-8000-000000000006', 't060-observer', 'T-060 Observer');

INSERT INTO public.permissions (id, code, name) VALUES
  ('60000000-0000-4000-8000-000000000007', 'inventory.adjustments.register', 'Register Adjustments'),
  ('60000000-0000-4000-8000-000000000008', 'inventory.waste.register', 'Register Waste')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('60000000-0000-4000-8000-000000000001', 'T-060 Adjuster', true),
  ('60000000-0000-4000-8000-000000000002', 'T-060 Waste Recorder', true),
  ('60000000-0000-4000-8000-000000000003', 'T-060 Observer', true);
INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004'),
  ('60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000005'),
  ('60000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000006');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '60000000-0000-4000-8000-000000000004', id FROM public.permissions
WHERE code = 'inventory.adjustments.register';
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '60000000-0000-4000-8000-000000000005', id FROM public.permissions
WHERE code = 'inventory.waste.register';

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES
  ('60000000-0000-4000-8000-000000000010', 'T-060 No Negative', true, transaction_timestamp()),
  ('60000000-0000-4000-8000-000000000011', 'T-060 Negative Allowed', true, transaction_timestamp());
INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES
  ('60000000-0000-4000-8000-000000000010', 0, 5, 7, 6, 8, '{"allowNegativeStock": false}'::jsonb, '{}'::jsonb, '{}'::jsonb, transaction_timestamp()),
  ('60000000-0000-4000-8000-000000000011', 0, 5, 7, 6, 8, '{"allowNegativeStock": true}'::jsonb, '{}'::jsonb, '{}'::jsonb, transaction_timestamp());
INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES
  ('60000000-0000-4000-8000-000000000012', '60000000-0000-4000-8000-000000000010', 'T-060 Flour', 'RAW_INGREDIENT', 'kg', 1, true, transaction_timestamp()),
  ('60000000-0000-4000-8000-000000000013', '60000000-0000-4000-8000-000000000010', 'T-060 Inactive', 'RAW_INGREDIENT', 'kg', 1, false, transaction_timestamp()),
  ('60000000-0000-4000-8000-000000000014', '60000000-0000-4000-8000-000000000011', 'T-060 Other Flour', 'RAW_INGREDIENT', 'kg', 1, true, transaction_timestamp());

CREATE TEMP TABLE t060_adjustment_result AS
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000010',
  '60000000-0000-4000-8000-000000000012',
  'ADJUSTMENT', '5', ' opening   count ', transaction_timestamp(), '192.0.2.60'
);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $probe$
DECLARE result_row record;
BEGIN
  SELECT * INTO result_row FROM t060_adjustment_result;
  IF result_row.operation_type <> 'ADJUSTMENT'
    OR result_row.quantity_delta <> 5
    OR result_row.previous_balance <> 0
    OR result_row.new_balance <> 5
    OR result_row.reason <> 'opening count'
    OR NOT EXISTS (
      SELECT 1 FROM public.inventory_adjustments
      WHERE id = result_row.origin_id
        AND inventory_movement_id = result_row.inventory_movement_id
        AND quantity_delta = 5 AND unit_of_measure = 'kg'
        AND reason = 'opening count'
        AND recorded_by_id = '60000000-0000-4000-8000-000000000001'
        AND recorded_at = result_row.recorded_at
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE id = result_row.inventory_movement_id
        AND type = 'ADJUSTMENT' AND business_origin_type = 'ADJUSTMENT'
        AND business_origin_id = result_row.origin_id
        AND quantity_delta = 5 AND unit_of_measure = 'kg'
        AND comments = 'opening count'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE action = 'inventory_adjustment.registered'
        AND entity_id = result_row.origin_id::text
        AND actor_id = '60000000-0000-4000-8000-000000000001'
        AND (previous_values ->> 'balance')::numeric = 0
        AND (new_values ->> 'balance')::numeric = 5
        AND new_values ->> 'reason' = 'opening count'
        AND source_ip = '192.0.2.60'::inet
    ) THEN
    RAISE EXCEPTION 'adjustment did not create exact atomic records';
  END IF;
END;
$probe$;

CREATE TEMP TABLE t060_waste_result AS
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '60000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000010',
  '60000000-0000-4000-8000-000000000012',
  'WASTE', '2.250', ' spoiled   during prep ', transaction_timestamp(), NULL
);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $probe$
DECLARE result_row record;
BEGIN
  SELECT * INTO result_row FROM t060_waste_result;
  IF result_row.operation_type <> 'WASTE'
    OR result_row.quantity_delta <> -2.250
    OR result_row.previous_balance <> 5
    OR result_row.new_balance <> 2.750
    OR NOT EXISTS (
      SELECT 1 FROM public.inventory_waste_records
      WHERE id = result_row.origin_id
        AND inventory_movement_id = result_row.inventory_movement_id
        AND quantity = 2.250 AND reason = 'spoiled during prep'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE id = result_row.inventory_movement_id
        AND type = 'WASTE' AND quantity_delta = -2.250
        AND business_origin_type = 'WASTE'
        AND business_origin_id = result_row.origin_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE action = 'inventory_waste.registered'
        AND entity_id = result_row.origin_id::text
        AND (previous_values ->> 'balance')::numeric = 5
        AND (new_values ->> 'balance')::numeric = 2.750
    ) THEN
    RAISE EXCEPTION 'waste did not create exact atomic records';
  END IF;
END;
$probe$;

DO $probe$
BEGIN
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000012', 'WASTE', '1', 'wrong permission', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'permission split was not enforced';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000012', 'ADJUSTMENT', '1', 'wrong permission', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'permission split was not enforced';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000012', 'ADJUSTMENT', '1', 'unauthorized', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'permission split was not enforced';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$probe$;

DO $probe$
BEGIN
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000012', 'ADJUSTMENT', '-10', 'bad count', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'negative stock was accepted when disabled';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_MOVEMENT_NEGATIVE_STOCK_DISALLOWED%' THEN RAISE; END IF;
  END;

  PERFORM * FROM public.register_inventory_adjustment_or_waste(
    '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000011',
    '60000000-0000-4000-8000-000000000014', 'ADJUSTMENT', '-1', 'negative allowed', transaction_timestamp(), NULL
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_balances
    WHERE restaurant_id = '60000000-0000-4000-8000-000000000011'
      AND inventory_item_id = '60000000-0000-4000-8000-000000000014'
      AND current_balance = -1
  ) THEN
    RAISE EXCEPTION 'negative stock was rejected when enabled';
  END IF;
END;
$probe$;

DO $probe$
BEGIN
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000014', 'ADJUSTMENT', '1', 'cross tenant', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'cross-tenant item was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_MOVEMENT_ITEM_UNAVAILABLE%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000013', 'ADJUSTMENT', '1', 'inactive', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'inactive item was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_MOVEMENT_ITEM_UNAVAILABLE%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000099', 'ADJUSTMENT', '1', 'missing', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'missing item was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVENTORY_MOVEMENT_ITEM_UNAVAILABLE%' THEN RAISE; END IF;
  END;
END;
$probe$;

DO $probe$
DECLARE adjustment_result record; waste_result record;
BEGIN
  SELECT * INTO adjustment_result FROM t060_adjustment_result;
  SELECT * INTO waste_result FROM t060_waste_result;
  BEGIN
    UPDATE public.inventory_adjustments SET reason = 'changed' WHERE id = adjustment_result.origin_id;
    RAISE EXCEPTION 'inventory_adjustments history is immutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM public.inventory_waste_records WHERE id = waste_result.origin_id;
    RAISE EXCEPTION 'inventory_waste_records history is immutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END;
$probe$;

DO $probe$
DECLARE adjustment_result record;
BEGIN
  SELECT * INTO adjustment_result FROM t060_adjustment_result;
  BEGIN
    INSERT INTO public.inventory_movements (
      restaurant_id, inventory_item_id, type, quantity_delta, unit_of_measure,
      recorded_by_id, recorded_at, business_origin_type, business_origin_id, comments
    ) VALUES (
      adjustment_result.restaurant_id, adjustment_result.inventory_item_id,
      'ADJUSTMENT', 1, adjustment_result.unit_of_measure,
      adjustment_result.recorded_by_id, adjustment_result.recorded_at,
      'ADJUSTMENT', adjustment_result.origin_id, adjustment_result.reason
    );
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'additional adjustment-origin movement was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%movement origin is not exclusive%' THEN RAISE; END IF;
  END;
END;
$probe$;

CREATE FUNCTION pg_temp.reject_t060_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'inventory_adjustment.registered' THEN
    RAISE EXCEPTION 'T060_FORCED_AUDIT_FAILURE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER t060_force_audit_failure
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_t060_audit();

DO $probe$
DECLARE origins_before bigint; movements_before bigint;
BEGIN
  SELECT count(*) INTO origins_before FROM public.inventory_adjustments;
  SELECT count(*) INTO movements_before FROM public.inventory_movements;
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000010',
      '60000000-0000-4000-8000-000000000012', 'ADJUSTMENT', '1', 'forced failure', transaction_timestamp(), NULL
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%T060_FORCED_AUDIT_FAILURE%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.inventory_adjustments) <> origins_before
    OR (SELECT count(*) FROM public.inventory_movements) <> movements_before THEN
    RAISE EXCEPTION 'forced audit failure left partial records';
  END IF;
END;
$probe$;

ROLLBACK;
