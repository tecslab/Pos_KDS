BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '45000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't045-authorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '45000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't045-unauthorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name) VALUES
  ('45000000-0000-4000-8000-000000000003', 't045-canceller', 'T-045 Canceller'),
  ('45000000-0000-4000-8000-000000000004', 't045-waiter', 'T-045 Waiter');

INSERT INTO public.permissions (id, code, name) VALUES
  ('45000000-0000-4000-8000-000000000005', 'orders.create', 'Create Orders'),
  ('45000000-0000-4000-8000-000000000006', 'orders.cancel', 'Cancel Orders')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('45000000-0000-4000-8000-000000000001', 'T-045 Authorized', true),
  ('45000000-0000-4000-8000-000000000002', 'T-045 Unauthorized', true);

INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003'),
  ('45000000-0000-4000-8000-000000000002', '45000000-0000-4000-8000-000000000004');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '45000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code IN ('orders.create', 'orders.cancel');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '45000000-0000-4000-8000-000000000004', permission.id
FROM public.permissions AS permission
WHERE permission.code = 'orders.create';

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES (
  '45000000-0000-4000-8000-000000000007',
  'T-045 Probe Restaurant', true, CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES (
  '45000000-0000-4000-8000-000000000007',
  0, 5, 7, 6, 8,
  '{"allowNegativeStock": false}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP
);

INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '45000000-0000-4000-8000-000000000008',
  '45000000-0000-4000-8000-000000000007',
  'T-045 Counter', 'COUNTER', 0, true, true, CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_tax_rates (
  id, restaurant_id, code, name, rate, is_active, updated_at
) VALUES (
  '45000000-0000-4000-8000-000000000009',
  '45000000-0000-4000-8000-000000000007',
  'T045', 'T-045 Tax', 0, true, CURRENT_TIMESTAMP
);

INSERT INTO public.product_catalogs (restaurant_id, name, is_active, updated_at)
VALUES (
  '45000000-0000-4000-8000-000000000007',
  'T-045 Catalog', true, CURRENT_TIMESTAMP
);

INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '45000000-0000-4000-8000-000000000010',
  '45000000-0000-4000-8000-000000000007',
  'T-045 Category', 0, true, CURRENT_TIMESTAMP
);

INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES (
  '45000000-0000-4000-8000-000000000011',
  '45000000-0000-4000-8000-000000000007',
  'T-045 Resale Item', 'RESALE_ITEM', 'each', 0, true, CURRENT_TIMESTAMP
);

INSERT INTO public.inventory_movements (
  id, restaurant_id, inventory_item_id, type, quantity_delta,
  unit_of_measure, recorded_by_id, recorded_at,
  business_origin_type, business_origin_id
) VALUES (
  '45000000-0000-4000-8000-000000000012',
  '45000000-0000-4000-8000-000000000007',
  '45000000-0000-4000-8000-000000000011',
  'PURCHASE', 10, 'each',
  '45000000-0000-4000-8000-000000000001',
  transaction_timestamp() - interval '3 minutes',
  'PURCHASE', '45000000-0000-4000-8000-000000000013'
);

INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES (
  '45000000-0000-4000-8000-000000000014',
  '45000000-0000-4000-8000-000000000007',
  '45000000-0000-4000-8000-000000000010',
  0, true, CURRENT_TIMESTAMP
);

INSERT INTO public.product_versions (
  id, restaurant_id, product_id, version_number, name, unit_price,
  printer_alias, tax_rate_id, tax_code, tax_name, tax_rate,
  price_includes_tax, resale_inventory_item_id
) VALUES (
  '45000000-0000-4000-8000-000000000015',
  '45000000-0000-4000-8000-000000000007',
  '45000000-0000-4000-8000-000000000014',
  1, 'T-045 Bottled Drink', 2.00, 'T045-DRINK',
  '45000000-0000-4000-8000-000000000009',
  'T045', 'T-045 Tax', 0, true,
  '45000000-0000-4000-8000-000000000011'
);

DO $probe$
DECLARE
  pending_order_id uuid;
  ready_order_id uuid;
  invalid_order_id uuid;
  source_sale_id uuid;
  returned_previous_status public.order_status;
  returned_movements jsonb;
  audit_before bigint;
  rollback_before bigint;
  current_balance numeric(14, 3);
BEGIN
  SELECT confirmation.order_id
  INTO pending_order_id
  FROM public.confirm_order(
    '45000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000008',
    NULL,
    jsonb_build_array(jsonb_build_object(
      'clientCorrelationId', 't045-pending-basket',
      'lines', jsonb_build_array(jsonb_build_object(
        'productVersionId', '45000000-0000-4000-8000-000000000015',
        'quantity', 2,
        'optionIds', jsonb_build_array(),
        'removableIngredientIds', jsonb_build_array(),
        'observations', NULL
      ))
    ))::text,
    transaction_timestamp() - interval '2 minutes',
    '192.0.2.45'
  ) AS confirmation;
  DROP TABLE IF EXISTS pg_temp.order_confirmation_lines;
  DROP TABLE IF EXISTS pg_temp.order_confirmation_resale_movements;

  SELECT movement.id
  INTO source_sale_id
  FROM public.inventory_movements AS movement
  WHERE movement.business_origin_type = 'SALE'
    AND movement.business_origin_id = pending_order_id
    AND movement.type = 'SALE';

  INSERT INTO public.inventory_movements (
    id, restaurant_id, inventory_item_id, type, quantity_delta,
    unit_of_measure, recorded_by_id, recorded_at,
    business_origin_type, business_origin_id, comments, reversed_movement_id
  ) VALUES (
    '45000000-0000-4000-8000-000000000016',
    '45000000-0000-4000-8000-000000000007',
    '45000000-0000-4000-8000-000000000011',
    'ROLLBACK', 0.500, 'each',
    '45000000-0000-4000-8000-000000000001',
    transaction_timestamp() - interval '1 minute',
    'ROLLBACK', pending_order_id, 'Prior partial reconciliation', source_sale_id
  );

  UPDATE public.inventory_items
  SET is_active = false, updated_at = transaction_timestamp()
  WHERE id = '45000000-0000-4000-8000-000000000011';

  SELECT cancellation.previous_status, cancellation.inventory_movements
  INTO returned_previous_status, returned_movements
  FROM public.cancel_order(
    '45000000-0000-4000-8000-000000000001',
    pending_order_id,
    'Customer requested cancellation',
    transaction_timestamp(),
    '192.0.2.45'
  ) AS cancellation;

  IF returned_previous_status <> 'PENDING'
    OR jsonb_array_length(returned_movements) <> 1
    OR (returned_movements -> 0 ->> 'quantity_delta')::numeric <> 1.500
    OR returned_movements -> 0 ->> 'reversed_movement_id' <> source_sale_id::text THEN
    RAISE EXCEPTION 'PENDING cancellation did not restore residual resale stock';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS cancelled_order
    JOIN public.order_cancellations AS cancellation
      ON cancellation.restaurant_id = cancelled_order.restaurant_id
     AND cancellation.order_id = cancelled_order.id
    WHERE cancelled_order.id = pending_order_id
      AND cancelled_order.status = 'CANCELLED'
      AND cancellation.previous_status = 'PENDING'
      AND cancellation.cancelled_by_id = '45000000-0000-4000-8000-000000000001'
      AND cancellation.reason = 'Customer requested cancellation'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.audit_events AS audit
    WHERE audit.action = 'order.cancelled'
      AND audit.entity_id = pending_order_id::text
      AND audit.previous_values ->> 'status' = 'PENDING'
      AND audit.new_values ->> 'status' = 'CANCELLED'
      AND audit.source_ip = '192.0.2.45'::inet
  ) THEN
    RAISE EXCEPTION 'PENDING cancellation did not persist final state and audit';
  END IF;

  SELECT balance.current_balance INTO current_balance
  FROM public.inventory_balances AS balance
  WHERE balance.inventory_item_id = '45000000-0000-4000-8000-000000000011';
  IF current_balance <> 10.000 THEN
    RAISE EXCEPTION 'PENDING cancellation did not restore residual resale stock';
  END IF;

  DROP TABLE IF EXISTS pg_temp.t045_movement_summaries;
  BEGIN
    PERFORM * FROM public.cancel_order(
      '45000000-0000-4000-8000-000000000001', pending_order_id,
      'Duplicate attempt', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'duplicate cancellation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ORDER_CANCELLATION_NOT_CANCELLABLE%' THEN RAISE; END IF;
  END;

  UPDATE public.inventory_items
  SET is_active = true, updated_at = transaction_timestamp()
  WHERE id = '45000000-0000-4000-8000-000000000011';

  SELECT confirmation.order_id
  INTO ready_order_id
  FROM public.confirm_order(
    '45000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000008',
    NULL,
    jsonb_build_array(jsonb_build_object(
      'clientCorrelationId', 't045-ready-basket',
      'lines', jsonb_build_array(jsonb_build_object(
        'productVersionId', '45000000-0000-4000-8000-000000000015',
        'quantity', 1,
        'optionIds', jsonb_build_array(),
        'removableIngredientIds', jsonb_build_array(),
        'observations', NULL
      ))
    ))::text,
    transaction_timestamp() - interval '2 minutes',
    NULL
  ) AS confirmation;
  DROP TABLE IF EXISTS pg_temp.order_confirmation_lines;
  DROP TABLE IF EXISTS pg_temp.order_confirmation_resale_movements;

  BEGIN
    PERFORM * FROM public.cancel_order(
      '45000000-0000-4000-8000-000000000002', ready_order_id,
      'Unauthorized attempt', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'unauthorized cancellation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT status FROM public.orders WHERE id = ready_order_id) <> 'PENDING'
    OR EXISTS (SELECT 1 FROM public.order_cancellations WHERE order_id = ready_order_id) THEN
    RAISE EXCEPTION 'unauthorized cancellation changed order state';
  END IF;

  UPDATE public.orders
  SET status = 'READY',
      ready_at = transaction_timestamp() - interval '30 seconds',
      updated_at = transaction_timestamp() - interval '30 seconds'
  WHERE id = ready_order_id;

  SELECT cancellation.previous_status
  INTO returned_previous_status
  FROM public.cancel_order(
    '45000000-0000-4000-8000-000000000001', ready_order_id,
    'Ready order cancelled', transaction_timestamp(), NULL
  ) AS cancellation;
  IF returned_previous_status <> 'READY'
    OR (SELECT status FROM public.orders WHERE id = ready_order_id) <> 'CANCELLED'
    OR NOT EXISTS (
      SELECT 1 FROM public.order_cancellations
      WHERE order_id = ready_order_id AND previous_status = 'READY'
    ) THEN
    RAISE EXCEPTION 'READY cancellation did not preserve previous state';
  END IF;
  DROP TABLE IF EXISTS pg_temp.t045_movement_summaries;

  SELECT confirmation.order_id
  INTO invalid_order_id
  FROM public.confirm_order(
    '45000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000008',
    NULL,
    jsonb_build_array(jsonb_build_object(
      'clientCorrelationId', 't045-invalid-basket',
      'lines', jsonb_build_array(jsonb_build_object(
        'productVersionId', '45000000-0000-4000-8000-000000000015',
        'quantity', 1,
        'optionIds', jsonb_build_array(),
        'removableIngredientIds', jsonb_build_array(),
        'observations', NULL
      ))
    ))::text,
    transaction_timestamp() - interval '2 minutes',
    NULL
  ) AS confirmation;
  DROP TABLE IF EXISTS pg_temp.order_confirmation_lines;
  DROP TABLE IF EXISTS pg_temp.order_confirmation_resale_movements;

  ALTER TABLE public.inventory_movements
    DROP CONSTRAINT inventory_movements_origin_matches_type;

  INSERT INTO public.inventory_movements (
    restaurant_id, inventory_item_id, type, quantity_delta,
    unit_of_measure, recorded_by_id, recorded_at,
    business_origin_type, business_origin_id
  ) VALUES (
    '45000000-0000-4000-8000-000000000007',
    '45000000-0000-4000-8000-000000000011',
    'ADJUSTMENT', 0.250, 'each',
    '45000000-0000-4000-8000-000000000001', transaction_timestamp(),
    'SALE', invalid_order_id
  );

  SELECT count(*) INTO audit_before
  FROM public.audit_events WHERE entity_id = invalid_order_id::text;
  SELECT count(*) INTO rollback_before
  FROM public.inventory_movements
  WHERE business_origin_type = 'ROLLBACK' AND business_origin_id = invalid_order_id;

  BEGIN
    PERFORM * FROM public.cancel_order(
      '45000000-0000-4000-8000-000000000001', invalid_order_id,
      'Must fail atomically', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'invalid provenance cancellation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ORDER_CANCELLATION_INVALID_INVENTORY_PROVENANCE%' THEN
      RAISE;
    END IF;
  END;

  IF (SELECT status FROM public.orders WHERE id = invalid_order_id) <> 'PENDING'
    OR EXISTS (SELECT 1 FROM public.order_cancellations WHERE order_id = invalid_order_id)
    OR (SELECT count(*) FROM public.audit_events WHERE entity_id = invalid_order_id::text) <> audit_before
    OR (SELECT count(*) FROM public.inventory_movements
        WHERE business_origin_type = 'ROLLBACK'
          AND business_origin_id = invalid_order_id) <> rollback_before THEN
    RAISE EXCEPTION 'failed provenance cancellation persisted partial state';
  END IF;
END;
$probe$;

ROLLBACK;
