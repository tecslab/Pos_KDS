BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '62000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  't062@example.invalid', '', transaction_timestamp(), '{}'::jsonb, '{}'::jsonb,
  transaction_timestamp(), transaction_timestamp()
);
INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('62000000-0000-4000-8000-000000000001', 'T-062 Actor', true);
INSERT INTO public.roles (id, code, name) VALUES
  ('62000000-0000-4000-8000-000000000002', 't062-actor', 'T-062 Actor');
INSERT INTO public.permissions (id, code, name) VALUES
  ('62000000-0000-4000-8000-000000000003',
   'inventory.adjustments.register', 'Register Adjustments'),
  ('62000000-0000-4000-8000-000000000004',
   'inventory.purchases.register', 'Register Purchases'),
  ('62000000-0000-4000-8000-000000000005',
   'orders.create', 'Create Orders'),
  ('62000000-0000-4000-8000-000000000006',
   'orders.edit', 'Edit Orders'),
  ('62000000-0000-4000-8000-000000000007',
   'orders.cancel', 'Cancel Orders'),
  ('62000000-0000-4000-8000-000000000008',
   'inventory.waste.register', 'Register Waste')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('62000000-0000-4000-8000-000000000001',
   '62000000-0000-4000-8000-000000000002');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '62000000-0000-4000-8000-000000000002', permission.id
FROM public.permissions AS permission
WHERE permission.code IN (
  'inventory.adjustments.register', 'inventory.waste.register',
  'inventory.purchases.register',
  'orders.create', 'orders.edit', 'orders.cancel'
);

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES
  ('62000000-0000-4000-8000-000000000010', 'T-062 A', true, transaction_timestamp()),
  ('62000000-0000-4000-8000-000000000011', 'T-062 B', true, transaction_timestamp());
INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES
  ('62000000-0000-4000-8000-000000000010', 0, 5, 7, 6, 8,
   '{"allowNegativeStock": true}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   transaction_timestamp()),
  ('62000000-0000-4000-8000-000000000011', 0, 5, 7, 6, 8,
   '{"allowNegativeStock": true}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   transaction_timestamp());
INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES
  ('62000000-0000-4000-8000-000000000020',
   '62000000-0000-4000-8000-000000000010', 'T-062 Flour',
   'RAW_INGREDIENT', 'kg', 5, true, transaction_timestamp()),
  ('62000000-0000-4000-8000-000000000021',
   '62000000-0000-4000-8000-000000000011', 'T-062 Other Flour',
   'RAW_INGREDIENT', 'kg', 5, true, transaction_timestamp()),
  ('62000000-0000-4000-8000-000000000022',
   '62000000-0000-4000-8000-000000000010', 'T-062 Bottled Drink',
   'RESALE_ITEM', 'each', 5, true, transaction_timestamp());

INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '62000000-0000-4000-8000-000000000030',
  '62000000-0000-4000-8000-000000000010', 'T-062 Counter',
  'COUNTER', 0, true, true, transaction_timestamp()
);
INSERT INTO public.restaurant_tax_rates (
  id, restaurant_id, code, name, rate, is_active, updated_at
) VALUES (
  '62000000-0000-4000-8000-000000000031',
  '62000000-0000-4000-8000-000000000010', 'T062', 'T-062 Tax',
  0, true, transaction_timestamp()
);
INSERT INTO public.product_catalogs (
  restaurant_id, name, is_active, updated_at
) VALUES (
  '62000000-0000-4000-8000-000000000010',
  'T-062 Catalog', true, transaction_timestamp()
);
INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '62000000-0000-4000-8000-000000000032',
  '62000000-0000-4000-8000-000000000010',
  'T-062 Drinks', 0, true, transaction_timestamp()
);
INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES (
  '62000000-0000-4000-8000-000000000033',
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000032', 0, true,
  transaction_timestamp()
);
INSERT INTO public.product_versions (
  id, restaurant_id, product_id, version_number, name, unit_price,
  printer_alias, tax_rate_id, tax_code, tax_name, tax_rate,
  price_includes_tax, resale_inventory_item_id
) VALUES (
  '62000000-0000-4000-8000-000000000034',
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000033', 1, 'T-062 Soda', 2,
  'T062-SODA', '62000000-0000-4000-8000-000000000031',
  'T062', 'T-062 Tax', 0, true,
  '62000000-0000-4000-8000-000000000022'
);
INSERT INTO public.expense_categories (
  id, restaurant_id, code, name, is_active, updated_at
) VALUES (
  '62000000-0000-4000-8000-000000000035',
  '62000000-0000-4000-8000-000000000010',
  't062_inventory', 'T-062 Inventory', true, transaction_timestamp()
);

CREATE TEMP TABLE t062_equal AS
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000020',
  'ADJUSTMENT', '5', 'at threshold', transaction_timestamp(), NULL
);

DO $probe$
DECLARE result_record record;
BEGIN
  SELECT * INTO result_record FROM t062_equal;
  IF jsonb_array_length(result_record.inventory_alert_transitions) <> 0
    OR EXISTS (
      SELECT 1 FROM public.inventory_alerts
      WHERE restaurant_id = '62000000-0000-4000-8000-000000000010'
    ) THEN
    RAISE EXCEPTION 'equality incorrectly opened a low-stock alert';
  END IF;
END;
$probe$;

CREATE TEMP TABLE t062_open AS
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000020',
  'WASTE', '1', 'below threshold', transaction_timestamp(), NULL
);
CREATE TEMP TABLE t062_still_low AS
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000020',
  'ADJUSTMENT', '-1', 'still low', transaction_timestamp(), NULL
);
CREATE TEMP TABLE t062_resolve AS
SELECT * FROM public.register_inventory_adjustment_or_waste(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000020',
  'ADJUSTMENT', '2', 'back to threshold', transaction_timestamp(), NULL
);

DO $probe$
DECLARE opened record; unchanged record; resolved record;
BEGIN
  SELECT * INTO opened FROM t062_open;
  SELECT * INTO unchanged FROM t062_still_low;
  SELECT * INTO resolved FROM t062_resolve;
  IF jsonb_array_length(opened.inventory_alert_transitions) <> 1
    OR opened.inventory_alert_transitions -> 0 ->> 'status' <> 'ACTIVE'
    OR (opened.inventory_alert_transitions -> 0 ->> 'threshold')::numeric <> 5
    OR (opened.inventory_alert_transitions -> 0 ->> 'observed_balance')::numeric <> 4
    OR jsonb_array_length(unchanged.inventory_alert_transitions) <> 0
    OR jsonb_array_length(resolved.inventory_alert_transitions) <> 1
    OR resolved.inventory_alert_transitions -> 0 ->> 'status' <> 'RESOLVED'
    OR (resolved.inventory_alert_transitions -> 0 ->> 'observed_balance')::numeric <> 5
    OR (SELECT count(*) FROM public.inventory_alerts
        WHERE restaurant_id = opened.restaurant_id
          AND inventory_item_id = opened.inventory_item_id) <> 1
    OR (SELECT count(*) FROM public.inventory_alert_transitions
        WHERE restaurant_id = opened.restaurant_id
          AND inventory_item_id = opened.inventory_item_id) <> 2 THEN
    RAISE EXCEPTION 'low-stock state transitions were not exact-once';
  END IF;
END;
$probe$;

-- Exercise every movement-producing RPC and validate the transition snapshot
-- returned by that exact transaction.
DO $probe$
DECLARE
  confirmation_record record;
  modification_record record;
  cancellation_record record;
  purchase_record record;
  basket_id_value uuid;
  line_id_value uuid;
  snapshot_id_value uuid;
BEGIN
  PERFORM * FROM public.register_inventory_adjustment_or_waste(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000010',
    '62000000-0000-4000-8000-000000000022',
    'ADJUSTMENT', '6', 'seed resale stock', transaction_timestamp(), NULL
  );

  SELECT confirmation.* INTO STRICT confirmation_record
  FROM public.confirm_order(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000030', NULL,
    jsonb_build_array(jsonb_build_object(
      'clientCorrelationId', 't062-basket',
      'lines', jsonb_build_array(jsonb_build_object(
        'productVersionId', '62000000-0000-4000-8000-000000000034',
        'quantity', 2,
        'optionIds', jsonb_build_array(),
        'removableIngredientIds', jsonb_build_array(),
        'observations', NULL
      ))
    ))::text,
    transaction_timestamp(), NULL
  ) AS confirmation;
  IF jsonb_array_length(confirmation_record.inventory_alert_transitions) <> 1
    OR confirmation_record.inventory_alert_transitions -> 0 ->> 'status' <> 'ACTIVE'
    OR (confirmation_record.inventory_alert_transitions -> 0 ->> 'observed_balance')::numeric <> 4 THEN
    RAISE EXCEPTION 'confirmation did not return its low-stock transition';
  END IF;

  SELECT basket.id, line.id, line.current_snapshot_id
  INTO STRICT basket_id_value, line_id_value, snapshot_id_value
  FROM public.customer_baskets AS basket
  JOIN public.order_lines AS line
    ON line.restaurant_id = basket.restaurant_id
   AND line.basket_id = basket.id
  WHERE basket.order_id = confirmation_record.order_id;

  SELECT modification.* INTO STRICT modification_record
  FROM public.modify_pending_order(
    '62000000-0000-4000-8000-000000000001',
    confirmation_record.order_id,
    confirmation_record.confirmed_at,
    jsonb_build_array(jsonb_build_object(
      'kind', 'replace',
      'lineId', line_id_value,
      'expectedCurrentSnapshotId', snapshot_id_value,
      'quantity', 1,
      'optionIds', jsonb_build_array(),
      'removableIngredientIds', jsonb_build_array(),
      'observations', NULL
    ))::text,
    confirmation_record.confirmed_at + interval '1 microsecond', NULL
  ) AS modification;
  IF jsonb_array_length(modification_record.inventory_alert_transitions) <> 1
    OR modification_record.inventory_alert_transitions -> 0 ->> 'status' <> 'RESOLVED'
    OR (modification_record.inventory_alert_transitions -> 0 ->> 'observed_balance')::numeric <> 5 THEN
    RAISE EXCEPTION 'modification did not return its resolved transition';
  END IF;

  PERFORM * FROM public.register_inventory_adjustment_or_waste(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000010',
    '62000000-0000-4000-8000-000000000022',
    'ADJUSTMENT', '-1', 'open before cancellation',
    modification_record.updated_at + interval '1 microsecond', NULL
  );
  SELECT cancellation.* INTO STRICT cancellation_record
  FROM public.cancel_order(
    '62000000-0000-4000-8000-000000000001',
    confirmation_record.order_id, 'T-062 cancellation',
    modification_record.updated_at + interval '2 microseconds', NULL
  ) AS cancellation;
  IF jsonb_array_length(cancellation_record.inventory_alert_transitions) <> 1
    OR cancellation_record.inventory_alert_transitions -> 0 ->> 'status' <> 'RESOLVED'
    OR (cancellation_record.inventory_alert_transitions -> 0 ->> 'observed_balance')::numeric <> 5 THEN
    RAISE EXCEPTION 'cancellation did not return its resolved transition';
  END IF;

  PERFORM * FROM public.register_inventory_adjustment_or_waste(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000010',
    '62000000-0000-4000-8000-000000000020',
    'ADJUSTMENT', '-1', 'open before purchase',
    cancellation_record.updated_at + interval '1 microsecond', NULL
  );
  SELECT purchase.* INTO STRICT purchase_record
  FROM public.register_inventory_purchase(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000010',
    '62000000-0000-4000-8000-000000000035',
    NULL, 'T062', NULL,
    '[{"inventoryItemId":"62000000-0000-4000-8000-000000000020","quantity":"1","unitPrice":"1"}]',
    cancellation_record.updated_at + interval '2 microseconds', NULL
  ) AS purchase;
  IF jsonb_array_length(purchase_record.inventory_alert_transitions) <> 1
    OR purchase_record.inventory_alert_transitions -> 0 ->> 'status' <> 'RESOLVED'
    OR (purchase_record.inventory_alert_transitions -> 0 ->> 'observed_balance')::numeric <> 5 THEN
    RAISE EXCEPTION 'purchase did not return its resolved transition';
  END IF;
END;
$probe$;

-- A second tenant has independent balance and alert state. Returning it to the
-- threshold also leaves it ready for the forced-rollback probe below.
DO $probe$
DECLARE tenant_a_transitions bigint;
BEGIN
  SELECT count(*) INTO tenant_a_transitions
  FROM public.inventory_alert_transitions
  WHERE restaurant_id = '62000000-0000-4000-8000-000000000010';

  PERFORM * FROM public.register_inventory_adjustment_or_waste(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000011',
    '62000000-0000-4000-8000-000000000021',
    'ADJUSTMENT', '5', 'tenant B threshold', transaction_timestamp(), NULL
  );
  PERFORM * FROM public.register_inventory_adjustment_or_waste(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000011',
    '62000000-0000-4000-8000-000000000021',
    'ADJUSTMENT', '-1', 'tenant B low', transaction_timestamp(), NULL
  );
  PERFORM * FROM public.register_inventory_adjustment_or_waste(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000011',
    '62000000-0000-4000-8000-000000000021',
    'ADJUSTMENT', '1', 'tenant B resolved', transaction_timestamp(), NULL
  );

  IF (SELECT count(*) FROM public.inventory_alert_transitions
      WHERE restaurant_id = '62000000-0000-4000-8000-000000000010')
       <> tenant_a_transitions
    OR (SELECT count(*) FROM public.inventory_alert_transitions
        WHERE restaurant_id = '62000000-0000-4000-8000-000000000011') <> 2 THEN
    RAISE EXCEPTION 'inventory alert state crossed tenant boundaries';
  END IF;
END;
$probe$;

DO $probe$
DECLARE transition_id bigint;
BEGIN
  SELECT min(id) INTO transition_id FROM public.inventory_alert_transitions;
  BEGIN
    UPDATE public.inventory_alert_transitions
    SET observed_balance = 999
    WHERE id = transition_id;
    RAISE EXCEPTION 'transition history was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END;
$probe$;

CREATE FUNCTION pg_temp.reject_t062_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'inventory_adjustment.registered' THEN
    RAISE EXCEPTION 'T062_FORCED_FAILURE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER t062_force_failure
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_t062_audit();

DO $probe$
DECLARE alerts_before bigint; transitions_before bigint; movements_before bigint;
BEGIN
  SELECT count(*) INTO alerts_before FROM public.inventory_alerts;
  SELECT count(*) INTO transitions_before FROM public.inventory_alert_transitions;
  SELECT count(*) INTO movements_before FROM public.inventory_movements;
  BEGIN
    PERFORM * FROM public.register_inventory_adjustment_or_waste(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000011',
      '62000000-0000-4000-8000-000000000021',
      'ADJUSTMENT', '-1', 'forced rollback', transaction_timestamp(), NULL
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%T062_FORCED_FAILURE%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.inventory_alerts) <> alerts_before
    OR (SELECT count(*) FROM public.inventory_alert_transitions) <> transitions_before
    OR (SELECT count(*) FROM public.inventory_movements) <> movements_before THEN
    RAISE EXCEPTION 'failed operation retained inventory alert effects';
  END IF;
END;
$probe$;

ROLLBACK;
