BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '79000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  't079-inventory-reconciliation@example.invalid',
  '',
  CURRENT_TIMESTAMP,
  '{}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO public.roles (id, code, name)
VALUES (
  '79000000-0000-4000-8000-000000000002',
  't079-inventory-reconciliation',
  'T-079 Inventory Reconciliation'
);

INSERT INTO public.permissions (id, code, name)
VALUES
  ('79000000-0000-4000-8000-000000000003', 'orders.create', 'Create Orders'),
  ('79000000-0000-4000-8000-000000000004', 'orders.edit', 'Edit Orders')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active)
VALUES (
  '79000000-0000-4000-8000-000000000001',
  'T-079 Probe User',
  true
);

INSERT INTO public.user_role_assignments (user_id, role_id)
VALUES (
  '79000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000002'
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '79000000-0000-4000-8000-000000000002', permission.id
FROM public.permissions AS permission
WHERE permission.code IN ('orders.create', 'orders.edit');

INSERT INTO public.restaurants (id, name, is_active, updated_at)
VALUES (
  '79000000-0000-4000-8000-000000000005',
  'T-079 Probe Restaurant',
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES (
  '79000000-0000-4000-8000-000000000005',
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
  '79000000-0000-4000-8000-000000000006',
  '79000000-0000-4000-8000-000000000005',
  'T-079 Probe Counter',
  'COUNTER',
  0,
  true,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_tax_rates (
  id, restaurant_id, code, name, rate, is_active, updated_at
) VALUES (
  '79000000-0000-4000-8000-000000000007',
  '79000000-0000-4000-8000-000000000005',
  'T079',
  'T-079 Tax',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.product_catalogs (restaurant_id, name, is_active, updated_at)
VALUES (
  '79000000-0000-4000-8000-000000000005',
  'T-079 Probe Catalog',
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '79000000-0000-4000-8000-000000000008',
  '79000000-0000-4000-8000-000000000005',
  'T-079 Probe Category',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.inventory_items (
  id, restaurant_id, name, type, unit_of_measure,
  minimum_stock_level, is_active, updated_at
) VALUES (
  '79000000-0000-4000-8000-000000000009',
  '79000000-0000-4000-8000-000000000005',
  'T-079 Resale Item',
  'RESALE_ITEM',
  'each',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.inventory_movements (
  id, restaurant_id, inventory_item_id, type, quantity_delta,
  unit_of_measure, recorded_by_id, recorded_at,
  business_origin_type, business_origin_id
) VALUES (
  '79000000-0000-4000-8000-000000000010',
  '79000000-0000-4000-8000-000000000005',
  '79000000-0000-4000-8000-000000000009',
  'PURCHASE',
  5,
  'each',
  '79000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP - interval '1 minute',
  'PURCHASE',
  '79000000-0000-4000-8000-000000000011'
);

INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES
  (
    '79000000-0000-4000-8000-000000000012',
    '79000000-0000-4000-8000-000000000005',
    '79000000-0000-4000-8000-000000000008',
    0,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    '79000000-0000-4000-8000-000000000013',
    '79000000-0000-4000-8000-000000000005',
    '79000000-0000-4000-8000-000000000008',
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
    '79000000-0000-4000-8000-000000000014',
    '79000000-0000-4000-8000-000000000005',
    '79000000-0000-4000-8000-000000000012',
    1,
    'T-079 Bottled Drink',
    2.00,
    'T079-DRINK',
    '79000000-0000-4000-8000-000000000007',
    'T079',
    'T-079 Tax',
    0,
    true,
    '79000000-0000-4000-8000-000000000009'
  ),
  (
    '79000000-0000-4000-8000-000000000015',
    '79000000-0000-4000-8000-000000000005',
    '79000000-0000-4000-8000-000000000013',
    1,
    'T-079 Prepared Item',
    1.00,
    'T079-PREPARED',
    '79000000-0000-4000-8000-000000000007',
    'T079',
    'T-079 Tax',
    0,
    true,
    NULL
  );

DO $probe$
DECLARE
  target_order_id uuid;
  target_basket_id uuid;
  resale_line_id uuid;
  resale_snapshot_id uuid;
  non_resale_line_id uuid;
  non_resale_snapshot_id uuid;
  source_sale_id uuid;
  expected_updated_at timestamptz;
  result_updated_at timestamptz;
  returned_movements jsonb;
  before_rejection jsonb;
  after_rejection jsonb;
BEGIN
  SELECT confirmation.order_id
  INTO target_order_id
  FROM public.confirm_order(
    '79000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000006',
    NULL,
    jsonb_build_array(jsonb_build_object(
      'clientCorrelationId', 't079-basket',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'productVersionId', '79000000-0000-4000-8000-000000000014',
          'quantity', 2,
          'optionIds', jsonb_build_array(),
          'removableIngredientIds', jsonb_build_array(),
          'observations', NULL
        ),
        jsonb_build_object(
          'productVersionId', '79000000-0000-4000-8000-000000000015',
          'quantity', 1,
          'optionIds', jsonb_build_array(),
          'removableIngredientIds', jsonb_build_array(),
          'observations', NULL
        )
      )
    ))::text,
    transaction_timestamp(),
    '192.0.2.79'
  ) AS confirmation;

  DROP TABLE IF EXISTS pg_temp.order_confirmation_lines;
  DROP TABLE IF EXISTS pg_temp.order_confirmation_resale_movements;

  SELECT movement.id
  INTO source_sale_id
  FROM public.inventory_movements AS movement
  WHERE movement.business_origin_type = 'SALE'
    AND movement.business_origin_id = target_order_id
    AND movement.inventory_item_id = '79000000-0000-4000-8000-000000000009';

  SELECT basket.id, target_order.updated_at
  INTO target_basket_id, expected_updated_at
  FROM public.customer_baskets AS basket
  JOIN public.orders AS target_order ON target_order.id = basket.order_id
  WHERE basket.order_id = target_order_id;

  SELECT line.id, snapshot.id
  INTO resale_line_id, resale_snapshot_id
  FROM public.order_lines AS line
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.id = line.current_snapshot_id
  WHERE line.basket_id = target_basket_id
    AND snapshot.product_version_id = '79000000-0000-4000-8000-000000000014';

  SELECT modification.updated_at, modification.inventory_movements
  INTO result_updated_at, returned_movements
  FROM public.modify_pending_order(
    '79000000-0000-4000-8000-000000000001',
    target_order_id,
    expected_updated_at,
    jsonb_build_array(jsonb_build_object(
      'kind', 'add',
      'basketId', target_basket_id,
      'clientCorrelationId', 't079-increase',
      'productVersionId', '79000000-0000-4000-8000-000000000014',
      'quantity', 3,
      'optionIds', jsonb_build_array(),
      'removableIngredientIds', jsonb_build_array(),
      'observations', NULL
    ))::text,
    expected_updated_at + interval '1 microsecond',
    '192.0.2.79'
  ) AS modification;

  IF jsonb_array_length(returned_movements) <> 1
    OR returned_movements -> 0 ->> 'type' <> 'SALE'
    OR (returned_movements -> 0 ->> 'quantity_delta')::numeric <> -3
    OR (SELECT count(*) FROM public.inventory_movements AS movement
        WHERE movement.business_origin_type = 'SALE'
          AND movement.business_origin_id = target_order_id
          AND movement.quantity_delta = -3) <> 1 THEN
    RAISE EXCEPTION 'increase did not append one aggregated sale';
  END IF;

  DROP TABLE IF EXISTS pg_temp.touched_order_lines;
  DROP TABLE IF EXISTS pg_temp.add_correlations;
  DROP TABLE IF EXISTS pg_temp.t079_resale_before;
  DROP TABLE IF EXISTS pg_temp.t079_resale_after;
  DROP TABLE IF EXISTS pg_temp.t079_resale_deltas;
  DROP TABLE IF EXISTS pg_temp.t079_movement_summaries;

  SELECT line.current_snapshot_id
  INTO resale_snapshot_id
  FROM public.order_lines AS line
  WHERE line.id = resale_line_id;

  UPDATE public.inventory_items
  SET is_active = false, updated_at = result_updated_at
  WHERE id = '79000000-0000-4000-8000-000000000009';

  SELECT modification.updated_at, modification.inventory_movements
  INTO result_updated_at, returned_movements
  FROM public.modify_pending_order(
    '79000000-0000-4000-8000-000000000001',
    target_order_id,
    result_updated_at,
    jsonb_build_array(jsonb_build_object(
      'kind', 'replace',
      'lineId', resale_line_id,
      'expectedCurrentSnapshotId', resale_snapshot_id,
      'quantity', 4,
      'optionIds', jsonb_build_array(),
      'removableIngredientIds', jsonb_build_array(),
      'observations', NULL
    ))::text,
    result_updated_at + interval '1 microsecond',
    NULL
  ) AS modification;

  IF jsonb_array_length(returned_movements) <> 1
    OR returned_movements -> 0 ->> 'type' <> 'ROLLBACK'
    OR (returned_movements -> 0 ->> 'quantity_delta')::numeric <> 1
    OR returned_movements -> 0 ->> 'reversed_movement_id' <> source_sale_id::text THEN
    RAISE EXCEPTION 'partial reduction did not append a linked rollback';
  END IF;

  UPDATE public.inventory_items
  SET is_active = true, updated_at = result_updated_at
  WHERE id = '79000000-0000-4000-8000-000000000009';

  DROP TABLE IF EXISTS pg_temp.touched_order_lines;
  DROP TABLE IF EXISTS pg_temp.add_correlations;
  DROP TABLE IF EXISTS pg_temp.t079_resale_before;
  DROP TABLE IF EXISTS pg_temp.t079_resale_after;
  DROP TABLE IF EXISTS pg_temp.t079_resale_deltas;
  DROP TABLE IF EXISTS pg_temp.t079_movement_summaries;

  SELECT line.current_snapshot_id
  INTO resale_snapshot_id
  FROM public.order_lines AS line
  WHERE line.id = resale_line_id;

  SELECT modification.updated_at, modification.inventory_movements
  INTO result_updated_at, returned_movements
  FROM public.modify_pending_order(
    '79000000-0000-4000-8000-000000000001',
    target_order_id,
    result_updated_at,
    jsonb_build_array(jsonb_build_object(
      'kind', 'remove',
      'lineId', resale_line_id,
      'expectedCurrentSnapshotId', resale_snapshot_id
    ))::text,
    result_updated_at + interval '1 microsecond',
    NULL
  ) AS modification;

  IF (SELECT COALESCE(sum((movement ->> 'quantity_delta')::numeric), 0)
      FROM jsonb_array_elements(returned_movements) AS movement) <> 4
    OR EXISTS (
      SELECT 1
      FROM public.inventory_movements AS sale
      WHERE sale.business_origin_type = 'SALE'
        AND sale.business_origin_id = target_order_id
        AND sale.inventory_item_id = '79000000-0000-4000-8000-000000000009'
        AND -sale.quantity_delta <> (
          SELECT COALESCE(sum(rollback.quantity_delta), 0)
          FROM public.inventory_movements AS rollback
          WHERE rollback.reversed_movement_id = sale.id
        )
    ) THEN
    RAISE EXCEPTION 'removal did not restore the remaining sale quantity';
  END IF;

  DROP TABLE IF EXISTS pg_temp.touched_order_lines;
  DROP TABLE IF EXISTS pg_temp.add_correlations;
  DROP TABLE IF EXISTS pg_temp.t079_resale_before;
  DROP TABLE IF EXISTS pg_temp.t079_resale_after;
  DROP TABLE IF EXISTS pg_temp.t079_resale_deltas;
  DROP TABLE IF EXISTS pg_temp.t079_movement_summaries;

  SELECT line.id, line.current_snapshot_id
  INTO non_resale_line_id, non_resale_snapshot_id
  FROM public.order_lines AS line
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.id = line.current_snapshot_id
  WHERE line.basket_id = target_basket_id
    AND snapshot.product_version_id = '79000000-0000-4000-8000-000000000015';

  SELECT modification.updated_at, modification.inventory_movements
  INTO result_updated_at, returned_movements
  FROM public.modify_pending_order(
    '79000000-0000-4000-8000-000000000001',
    target_order_id,
    result_updated_at,
    jsonb_build_array(jsonb_build_object(
      'kind', 'replace',
      'lineId', non_resale_line_id,
      'expectedCurrentSnapshotId', non_resale_snapshot_id,
      'quantity', 2,
      'optionIds', jsonb_build_array(),
      'removableIngredientIds', jsonb_build_array(),
      'observations', NULL
    ))::text,
    result_updated_at + interval '1 microsecond',
    NULL
  ) AS modification;

  IF returned_movements <> '[]'::jsonb THEN
    RAISE EXCEPTION 'non-resale modification changed inventory';
  END IF;

  DROP TABLE IF EXISTS pg_temp.touched_order_lines;
  DROP TABLE IF EXISTS pg_temp.add_correlations;
  DROP TABLE IF EXISTS pg_temp.t079_resale_before;
  DROP TABLE IF EXISTS pg_temp.t079_resale_after;
  DROP TABLE IF EXISTS pg_temp.t079_resale_deltas;
  DROP TABLE IF EXISTS pg_temp.t079_movement_summaries;

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.inventory_movements),
    (SELECT count(*) FROM public.audit_events)
  ) INTO before_rejection;

  BEGIN
    PERFORM *
    FROM public.modify_pending_order(
      '79000000-0000-4000-8000-000000000001',
      target_order_id,
      result_updated_at,
      jsonb_build_array(jsonb_build_object(
        'kind', 'add',
        'basketId', target_basket_id,
        'clientCorrelationId', 't079-insufficient',
        'productVersionId', '79000000-0000-4000-8000-000000000014',
        'quantity', 6,
        'optionIds', jsonb_build_array(),
        'removableIngredientIds', jsonb_build_array(),
        'observations', NULL
      ))::text,
      result_updated_at + interval '1 microsecond',
      NULL
    );
    RAISE EXCEPTION 'negative probe failed: insufficient inventory was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ORDER_MODIFICATION_INSUFFICIENT_INVENTORY' THEN
      RAISE;
    END IF;
  END;

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.inventory_movements),
    (SELECT count(*) FROM public.audit_events)
  ) INTO after_rejection;

  IF after_rejection IS DISTINCT FROM before_rejection THEN
    RAISE EXCEPTION 'insufficient-stock modification persisted partial state';
  END IF;

  BEGIN
    INSERT INTO public.inventory_movements (
      restaurant_id, inventory_item_id, type, quantity_delta,
      unit_of_measure, recorded_by_id, recorded_at,
      business_origin_type, business_origin_id, reversed_movement_id
    ) VALUES (
      '79000000-0000-4000-8000-000000000005',
      '79000000-0000-4000-8000-000000000009',
      'ROLLBACK',
      1,
      'each',
      '79000000-0000-4000-8000-000000000001',
      transaction_timestamp() + interval '1 minute',
      'ROLLBACK',
      target_order_id,
      source_sale_id
    );
    RAISE EXCEPTION 'negative probe failed: cumulative over-reversal was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM IS DISTINCT FROM 'rollback movements cannot cumulatively exceed the referenced movement' THEN
      RAISE;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.audit_events AS audit
    WHERE audit.action = 'inventory_movement.rollback_recorded'
      AND audit.new_values ->> 'businessOriginId' = target_order_id::text
      AND audit.new_values ? 'previousSnapshotQuantities'
      AND audit.new_values ? 'newSnapshotQuantities'
      AND audit.new_values ->> 'reversedMovementId' IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'movement audit provenance was not recorded';
  END IF;
END;
$probe$;

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
