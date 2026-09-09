BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('64000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 't064-producer@example.invalid', '', CURRENT_TIMESTAMP, '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('64000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 't064-observer@example.invalid', '', CURRENT_TIMESTAMP, '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO public.roles (id, code, name) VALUES
  ('64000000-0000-4000-8000-000000000003', 't064-producer', 'T-064 Producer'),
  ('64000000-0000-4000-8000-000000000004', 't064-observer', 'T-064 Observer');
INSERT INTO public.permissions (id, code, name) VALUES
  ('64000000-0000-4000-8000-000000000005', 'production.batch.create', 'Create Production Batch'),
  ('64000000-0000-4000-8000-000000000006', 'inventory.adjustments.register', 'Register Adjustments')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('64000000-0000-4000-8000-000000000001', 'T-064 Producer', true),
  ('64000000-0000-4000-8000-000000000002', 'T-064 Observer', true);
INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000003'),
  ('64000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000004');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '64000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code IN ('production.batch.create', 'inventory.adjustments.register');

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES
  ('64000000-0000-4000-8000-000000000010', 'T-064 Restaurant', true, transaction_timestamp()),
  ('64000000-0000-4000-8000-000000000011', 'T-064 Other Restaurant', true, transaction_timestamp());
INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES
  ('64000000-0000-4000-8000-000000000010', 0, 5, 7, 6, 8, '{"allowNegativeStock": true}'::jsonb, '{}'::jsonb, '{}'::jsonb, transaction_timestamp()),
  ('64000000-0000-4000-8000-000000000011', 0, 5, 7, 6, 8, '{"allowNegativeStock": true}'::jsonb, '{}'::jsonb, '{}'::jsonb, transaction_timestamp());

INSERT INTO public.product_catalogs (restaurant_id, name, is_active, updated_at)
VALUES ('64000000-0000-4000-8000-000000000010', 'T-064 Catalog', true, transaction_timestamp());
INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '64000000-0000-4000-8000-000000000012',
  '64000000-0000-4000-8000-000000000010',
  'T-064 Prepared', 1, true, transaction_timestamp()
);
INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES (
  '64000000-0000-4000-8000-000000000013',
  '64000000-0000-4000-8000-000000000010',
  '64000000-0000-4000-8000-000000000012', 1, true, transaction_timestamp()
);

INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES
  ('64000000-0000-4000-8000-000000000020', '64000000-0000-4000-8000-000000000010', 'T-064 Flour', 'RAW_INGREDIENT', 'kg', 9, true, transaction_timestamp()),
  ('64000000-0000-4000-8000-000000000021', '64000000-0000-4000-8000-000000000010', 'T-064 Sugar', 'RAW_INGREDIENT', 'kg', 0, true, transaction_timestamp()),
  ('64000000-0000-4000-8000-000000000022', '64000000-0000-4000-8000-000000000010', 'T-064 Dough', 'PRODUCED_ITEM', 'unit', 0, true, transaction_timestamp());

INSERT INTO public.recipes (
  id, restaurant_id, product_id, output_inventory_item_id,
  name, is_active, updated_at
) VALUES (
  '64000000-0000-4000-8000-000000000030',
  '64000000-0000-4000-8000-000000000010',
  '64000000-0000-4000-8000-000000000013',
  '64000000-0000-4000-8000-000000000022',
  'T-064 Dough Recipe', true, transaction_timestamp()
);
INSERT INTO public.recipe_versions (
  id, restaurant_id, recipe_id, version_number,
  produced_quantity, produced_unit, created_by_id
) VALUES
  ('64000000-0000-4000-8000-000000000031', '64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000030', 1, 10, 'unit', '64000000-0000-4000-8000-000000000001'),
  ('64000000-0000-4000-8000-000000000032', '64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000030', 2, 10, 'unit', '64000000-0000-4000-8000-000000000001');
INSERT INTO public.recipe_ingredients (
  restaurant_id, recipe_version_id, inventory_item_id,
  required_quantity, unit_of_measure
) VALUES
  ('64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000031', '64000000-0000-4000-8000-000000000020', 4, 'kg'),
  ('64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000031', '64000000-0000-4000-8000-000000000021', 2, 'kg'),
  ('64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000032', '64000000-0000-4000-8000-000000000020', 6, 'kg'),
  ('64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000032', '64000000-0000-4000-8000-000000000021', 3, 'kg');

SELECT * FROM public.register_inventory_adjustment_or_waste(
  '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000010',
  '64000000-0000-4000-8000-000000000020', 'ADJUSTMENT', '10', 'probe stock', transaction_timestamp(), NULL
);
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000010',
  '64000000-0000-4000-8000-000000000021', 'ADJUSTMENT', '10', 'probe stock', transaction_timestamp(), NULL
);
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000010',
  '64000000-0000-4000-8000-000000000022', 'ADJUSTMENT', '1', 'probe stock', transaction_timestamp(), NULL
);

CREATE TEMP TABLE t064_completion_result AS
SELECT * FROM public.complete_production_batch(
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000010',
  '64000000-0000-4000-8000-000000000031',
  '5', ' Morning   prep ', transaction_timestamp(), '192.0.2.64'
);
DROP TABLE pg_temp.production_ingredient_requirements;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $probe$
DECLARE result_row record;
BEGIN
  SELECT * INTO result_row FROM t064_completion_result;
  IF result_row.status <> 'COMPLETED'
    OR result_row.recipe_version_id <> '64000000-0000-4000-8000-000000000031'
    OR result_row.recipe_version_number <> 1
    OR result_row.produced_quantity <> 5
    OR result_row.notes <> 'Morning prep'
    OR jsonb_array_length(result_row.ingredient_movements) <> 2
    OR jsonb_array_length(result_row.inventory_alert_transitions) <> 1
    OR result_row.output_movement ->> 'inventoryItemId' <> '64000000-0000-4000-8000-000000000022'
    OR (result_row.output_movement ->> 'previousBalance')::numeric <> 1
    OR (result_row.output_movement ->> 'newBalance')::numeric <> 6
    OR (SELECT count(*) FROM public.production_batches WHERE id = result_row.batch_id AND status = 'COMPLETED') <> 1
    OR (SELECT count(*) FROM public.inventory_movements WHERE business_origin_type = 'PRODUCTION' AND business_origin_id = result_row.batch_id) <> 3
    OR NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE business_origin_id = result_row.batch_id
        AND inventory_item_id = '64000000-0000-4000-8000-000000000020'
        AND type = 'PRODUCTION_CONSUMPTION' AND quantity_delta = -2
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE business_origin_id = result_row.batch_id
        AND inventory_item_id = '64000000-0000-4000-8000-000000000021'
        AND type = 'PRODUCTION_CONSUMPTION' AND quantity_delta = -1
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE business_origin_id = result_row.batch_id
        AND inventory_item_id = '64000000-0000-4000-8000-000000000022'
        AND type = 'PRODUCTION_OUTPUT' AND quantity_delta = 5
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE action = 'production_batch.completed'
        AND entity_id = result_row.batch_id::text
        AND actor_id = '64000000-0000-4000-8000-000000000001'
        AND new_values ->> 'recipeVersionId' = '64000000-0000-4000-8000-000000000031'
        AND new_values ->> 'notes' = 'Morning prep'
        AND source_ip = '192.0.2.64'::inet
    ) THEN
    RAISE EXCEPTION 'production batch did not create exact atomic records';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE business_origin_id = result_row.batch_id
      AND inventory_item_id = '64000000-0000-4000-8000-000000000020'
      AND quantity_delta = -3
  ) THEN
    RAISE EXCEPTION 'selected historical recipe version was not preserved';
  END IF;
END;
$probe$;

DO $probe$
DECLARE batches_before bigint; movements_before bigint;
BEGIN
  SELECT count(*) INTO batches_before FROM public.production_batches;
  SELECT count(*) INTO movements_before FROM public.inventory_movements;
  BEGIN
    PERFORM * FROM public.complete_production_batch(
      '64000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000010',
      '64000000-0000-4000-8000-000000000031', '1', NULL, transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'unauthorized production was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.production_batches) <> batches_before
    OR (SELECT count(*) FROM public.inventory_movements) <> movements_before THEN
    RAISE EXCEPTION 'unauthorized production left partial state';
  END IF;
END;
$probe$;

DO $probe$
DECLARE batches_before bigint; movements_before bigint; audits_before bigint;
BEGIN
  SELECT count(*) INTO batches_before FROM public.production_batches;
  SELECT count(*) INTO movements_before FROM public.inventory_movements;
  SELECT count(*) INTO audits_before FROM public.audit_events WHERE action = 'production_batch.completed';
  BEGIN
    PERFORM * FROM public.complete_production_batch(
      '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000010',
      '64000000-0000-4000-8000-000000000031', '100', NULL, transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'insufficient inventory was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%PRODUCTION_INSUFFICIENT_INVENTORY%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.production_batches) <> batches_before
    OR (SELECT count(*) FROM public.inventory_movements) <> movements_before
    OR (SELECT count(*) FROM public.audit_events WHERE action = 'production_batch.completed') <> audits_before THEN
    RAISE EXCEPTION 'insufficient production left partial state';
  END IF;
END;
$probe$;

DO $probe$
BEGIN
  BEGIN
    PERFORM * FROM public.complete_production_batch(
      '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000011',
      '64000000-0000-4000-8000-000000000031', '1', NULL, transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'cross-tenant recipe version was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%PRODUCTION_RECIPE_VERSION_UNAVAILABLE%' THEN RAISE; END IF;
  END;

  UPDATE public.inventory_items SET is_active = false
  WHERE id = '64000000-0000-4000-8000-000000000021';
  BEGIN
    PERFORM * FROM public.complete_production_batch(
      '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000010',
      '64000000-0000-4000-8000-000000000031', '1', NULL, transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'inactive ingredient was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%PRODUCTION_INVENTORY_ITEM_UNAVAILABLE%' THEN RAISE; END IF;
  END;
  UPDATE public.inventory_items SET is_active = true
  WHERE id = '64000000-0000-4000-8000-000000000021';
END;
$probe$;

DO $probe$
DECLARE result_row record;
BEGIN
  SELECT * INTO result_row FROM t064_completion_result;
  BEGIN
    UPDATE public.production_batches SET notes = 'changed' WHERE id = result_row.batch_id;
    RAISE EXCEPTION 'completed production batch is immutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    INSERT INTO public.inventory_movements (
      restaurant_id, inventory_item_id, type, quantity_delta, unit_of_measure,
      recorded_by_id, recorded_at, business_origin_type, business_origin_id, comments
    ) VALUES (
      result_row.restaurant_id, '64000000-0000-4000-8000-000000000022',
      'PRODUCTION_OUTPUT', 1, 'unit', result_row.completed_by_id,
      result_row.completed_at, 'PRODUCTION', result_row.batch_id, result_row.notes
    );
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'additional production-origin movement was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%production batch movement origin is incomplete or not exclusive%' THEN RAISE; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$probe$;

CREATE FUNCTION pg_temp.reject_t064_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'production_batch.completed' THEN
    RAISE EXCEPTION 'T064_FORCED_AUDIT_FAILURE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER t064_force_audit_failure
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_t064_audit();

DO $probe$
DECLARE batches_before bigint; movements_before bigint;
BEGIN
  SELECT count(*) INTO batches_before FROM public.production_batches;
  SELECT count(*) INTO movements_before FROM public.inventory_movements;
  BEGIN
    PERFORM * FROM public.complete_production_batch(
      '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000010',
      '64000000-0000-4000-8000-000000000031', '1', NULL, transaction_timestamp(), NULL
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%T064_FORCED_AUDIT_FAILURE%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.production_batches) <> batches_before
    OR (SELECT count(*) FROM public.inventory_movements) <> movements_before THEN
    RAISE EXCEPTION 'forced audit failure left partial production state';
  END IF;
END;
$probe$;

ROLLBACK;
