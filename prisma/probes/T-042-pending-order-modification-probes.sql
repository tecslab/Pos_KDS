BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '42000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    't042-editor-probe@example.invalid',
    '',
    CURRENT_TIMESTAMP,
    '{}'::jsonb,
    '{}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    't042-unauthorized-probe@example.invalid',
    '',
    CURRENT_TIMESTAMP,
    '{}'::jsonb,
    '{}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name)
VALUES
  (
    '42000000-0000-4000-8000-000000000003',
    't042-editor-probe',
    'T-042 Editor Probe'
  ),
  (
    '42000000-0000-4000-8000-000000000004',
    't042-unauthorized-probe',
    'T-042 Unauthorized Probe'
  );

INSERT INTO public.permissions (id, code, name)
VALUES
  (
    '42000000-0000-4000-8000-000000000005',
    'orders.create',
    'Create Orders'
  ),
  (
    '42000000-0000-4000-8000-000000000006',
    'orders.edit',
    'Edit Orders'
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active)
VALUES
  (
    '42000000-0000-4000-8000-000000000001',
    'T-042 Editor',
    true
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    'T-042 Unauthorized User',
    true
  );

INSERT INTO public.user_role_assignments (user_id, role_id)
VALUES
  (
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000003'
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    '42000000-0000-4000-8000-000000000004'
  );

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '42000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code IN ('orders.create', 'orders.edit');

INSERT INTO public.restaurants (id, name, is_active, updated_at)
VALUES (
  '42000000-0000-4000-8000-000000000007',
  'T-042 Probe Restaurant',
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_configurations (
  restaurant_id, service_charge_rate,
  preparation_warning_threshold_minutes, preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes, delivery_critical_threshold_minutes,
  inventory_policy, printing_behavior, business_hours, updated_at
) VALUES (
  '42000000-0000-4000-8000-000000000007',
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
  '42000000-0000-4000-8000-000000000008',
  '42000000-0000-4000-8000-000000000007',
  'T-042 Probe Counter',
  'COUNTER',
  0,
  true,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_tax_rates (
  id, restaurant_id, code, name, rate, is_active, updated_at
) VALUES (
  '42000000-0000-4000-8000-000000000009',
  '42000000-0000-4000-8000-000000000007',
  'T042',
  'T-042 Tax',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.product_catalogs (restaurant_id, name, is_active, updated_at)
VALUES (
  '42000000-0000-4000-8000-000000000007',
  'T-042 Probe Catalog',
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '42000000-0000-4000-8000-000000000010',
  '42000000-0000-4000-8000-000000000007',
  'T-042 Probe Category',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES (
  '42000000-0000-4000-8000-000000000011',
  '42000000-0000-4000-8000-000000000007',
  '42000000-0000-4000-8000-000000000010',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.product_versions (
  id, restaurant_id, product_id, version_number, name, unit_price,
  printer_alias, tax_rate_id, tax_code, tax_name, tax_rate,
  price_includes_tax, resale_inventory_item_id
) VALUES (
  '42000000-0000-4000-8000-000000000012',
  '42000000-0000-4000-8000-000000000007',
  '42000000-0000-4000-8000-000000000011',
  1,
  'T-042 Probe Product',
  2.00,
  'T042-PRODUCT',
  '42000000-0000-4000-8000-000000000009',
  'T042',
  'T-042 Tax',
  0,
  true,
  NULL
);

DO $probe$
DECLARE
  target_order_id uuid;
  target_basket_id uuid;
  grouped_line_id uuid;
  grouped_snapshot_id uuid;
  separate_line_id uuid;
  separate_snapshot_id uuid;
  initial_updated_at timestamptz;
  first_updated_at timestamptz;
  second_updated_at timestamptz;
  before_rejection jsonb;
  after_rejection jsonb;
BEGIN
  SELECT confirmation.order_id
  INTO target_order_id
  FROM public.confirm_order(
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000008',
    NULL,
    jsonb_build_array(
      jsonb_build_object(
        'clientCorrelationId', 't042-basket',
        'lines', jsonb_build_array(
          jsonb_build_object(
            'productVersionId', '42000000-0000-4000-8000-000000000012',
            'quantity', 2,
            'optionIds', jsonb_build_array(),
            'removableIngredientIds', jsonb_build_array(),
            'observations', NULL
          ),
          jsonb_build_object(
            'productVersionId', '42000000-0000-4000-8000-000000000012',
            'quantity', 1,
            'optionIds', jsonb_build_array(),
            'removableIngredientIds', jsonb_build_array(),
            'observations', 'separate'
          )
        )
      )
    )::text,
    transaction_timestamp() - interval '1 second',
    '192.0.2.42'
  ) AS confirmation;

  EXECUTE 'DROP TABLE IF EXISTS pg_temp.order_confirmation_lines';
  EXECUTE 'DROP TABLE IF EXISTS pg_temp.order_confirmation_resale_movements';

  SELECT updated_at
  INTO initial_updated_at
  FROM public.orders
  WHERE id = target_order_id;

  SELECT basket.id
  INTO target_basket_id
  FROM public.customer_baskets AS basket
  WHERE basket.order_id = target_order_id;

  SELECT line.id, snapshot.id
  INTO grouped_line_id, grouped_snapshot_id
  FROM public.order_lines AS line
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.restaurant_id = line.restaurant_id
   AND snapshot.order_line_id = line.id
   AND snapshot.id = line.current_snapshot_id
  WHERE line.basket_id = target_basket_id
    AND snapshot.observations IS NULL;

  SELECT line.id, snapshot.id
  INTO separate_line_id, separate_snapshot_id
  FROM public.order_lines AS line
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.restaurant_id = line.restaurant_id
   AND snapshot.order_line_id = line.id
   AND snapshot.id = line.current_snapshot_id
  WHERE line.basket_id = target_basket_id
    AND snapshot.observations = 'separate';

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.order_line_removals),
    (SELECT count(*) FROM public.audit_events)
  )
  INTO before_rejection;

  BEGIN
    PERFORM *
    FROM public.modify_pending_order(
      '42000000-0000-4000-8000-000000000002',
      target_order_id,
      initial_updated_at,
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'add',
          'basketId', target_basket_id,
          'clientCorrelationId', 'unauthorized',
          'productVersionId', '42000000-0000-4000-8000-000000000012',
          'quantity', 1,
          'optionIds', jsonb_build_array(),
          'removableIngredientIds', jsonb_build_array(),
          'observations', NULL
        )
      )::text,
      initial_updated_at,
      NULL
    );
    RAISE EXCEPTION 'authorization probe failed: unauthorized modification was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM *
    FROM public.modify_pending_order(
      '42000000-0000-4000-8000-000000000001',
      target_order_id,
      initial_updated_at - interval '1 microsecond',
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'remove',
          'lineId', separate_line_id,
          'expectedCurrentSnapshotId', separate_snapshot_id
        )
      )::text,
      initial_updated_at,
      NULL
    );
    RAISE EXCEPTION 'concurrency probe failed: stale order token was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ORDER_MODIFICATION_STALE_ORDER' THEN
      RAISE;
    END IF;
  END;

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.order_line_removals),
    (SELECT count(*) FROM public.audit_events)
  )
  INTO after_rejection;

  IF after_rejection IS DISTINCT FROM before_rejection THEN
    RAISE EXCEPTION 'atomicity probe failed: authorization or stale rejection changed state';
  END IF;

  SELECT modification.updated_at
  INTO first_updated_at
  FROM public.modify_pending_order(
    '42000000-0000-4000-8000-000000000001',
    target_order_id,
    initial_updated_at,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'add',
        'basketId', target_basket_id,
        'clientCorrelationId', 'group-identical-add',
        'productVersionId', '42000000-0000-4000-8000-000000000012',
        'quantity', 1,
        'optionIds', jsonb_build_array(),
        'removableIngredientIds', jsonb_build_array(),
        'observations', NULL
      )
    )::text,
    initial_updated_at,
    '192.0.2.42'
  ) AS modification;

  EXECUTE 'DROP TABLE pg_temp.touched_order_lines';
  EXECUTE 'DROP TABLE pg_temp.add_correlations';

  IF first_updated_at <= initial_updated_at
    OR (SELECT count(*)
        FROM public.order_lines AS line
        LEFT JOIN public.order_line_removals AS removal
          ON removal.order_line_id = line.id
        WHERE line.basket_id = target_basket_id
          AND removal.order_line_id IS NULL) <> 2
    OR NOT EXISTS (
      SELECT 1
      FROM public.order_lines AS line
      JOIN public.order_line_sale_snapshots AS snapshot
        ON snapshot.id = line.current_snapshot_id
      WHERE line.id = grouped_line_id
        AND line.current_snapshot_id <> grouped_snapshot_id
        AND snapshot.revision_number = 2
        AND snapshot.quantity = 3
    )
    OR (SELECT total_amount FROM public.customer_baskets WHERE id = target_basket_id) <> 8
    OR (SELECT total_amount FROM public.orders WHERE id = target_order_id) <> 8
    OR NOT EXISTS (
      SELECT 1
      FROM public.audit_events
      WHERE action = 'order.updated'
        AND entity_id = target_order_id::text
        AND occurred_at = first_updated_at
        AND (previous_values ->> 'totalAmount')::numeric = 6
        AND (new_values ->> 'totalAmount')::numeric = 8
        AND (new_values ->> 'updatedAt')::timestamptz = first_updated_at
    ) THEN
    RAISE EXCEPTION 'grouping probe failed: identical add did not append one grouped revision and audit';
  END IF;

  SELECT modification.updated_at
  INTO second_updated_at
  FROM public.modify_pending_order(
    '42000000-0000-4000-8000-000000000001',
    target_order_id,
    first_updated_at,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'replace',
        'lineId', separate_line_id,
        'expectedCurrentSnapshotId', separate_snapshot_id,
        'quantity', 2,
        'optionIds', jsonb_build_array(),
        'removableIngredientIds', jsonb_build_array(),
        'observations', NULL
      )
    )::text,
    first_updated_at,
    '192.0.2.42'
  ) AS modification;

  EXECUTE 'DROP TABLE pg_temp.touched_order_lines';
  EXECUTE 'DROP TABLE pg_temp.add_correlations';

  IF second_updated_at <= first_updated_at
    OR (SELECT count(*)
        FROM public.order_lines AS line
        LEFT JOIN public.order_line_removals AS removal
          ON removal.order_line_id = line.id
        WHERE line.basket_id = target_basket_id
          AND removal.order_line_id IS NULL) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.order_lines AS line
      JOIN public.order_line_sale_snapshots AS snapshot
        ON snapshot.id = line.current_snapshot_id
      WHERE line.id = grouped_line_id
        AND snapshot.revision_number = 3
        AND snapshot.quantity = 5
        AND snapshot.line_total = 10
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.order_line_removals
      WHERE order_line_id = separate_line_id
        AND removed_snapshot_id = separate_snapshot_id
        AND removed_at = second_updated_at
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.order_line_sale_snapshots
      WHERE id = separate_snapshot_id
        AND order_line_id = separate_line_id
        AND revision_number = 1
    )
    OR (SELECT total_amount FROM public.customer_baskets WHERE id = target_basket_id) <> 10
    OR (SELECT total_amount FROM public.orders WHERE id = target_order_id) <> 10
    OR NOT EXISTS (
      SELECT 1
      FROM public.audit_events
      WHERE action = 'order.updated'
        AND entity_id = target_order_id::text
        AND occurred_at = second_updated_at
        AND (previous_values ->> 'totalAmount')::numeric = 8
        AND (new_values ->> 'totalAmount')::numeric = 10
    ) THEN
    RAISE EXCEPTION 'consolidation probe failed: replace did not preserve append-only grouped history';
  END IF;

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_lines),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.order_line_removals),
    (SELECT count(*) FROM public.audit_events)
  )
  INTO before_rejection;

  BEGIN
    PERFORM *
    FROM public.modify_pending_order(
      '42000000-0000-4000-8000-000000000001',
      target_order_id,
      second_updated_at,
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'add',
          'basketId', target_basket_id,
          'clientCorrelationId', 'must-roll-back',
          'productVersionId', '42000000-0000-4000-8000-000000000012',
          'quantity', 1,
          'optionIds', jsonb_build_array(),
          'removableIngredientIds', jsonb_build_array(),
          'observations', 'rollback-only'
        ),
        jsonb_build_object(
          'kind', 'remove',
          'lineId', grouped_line_id,
          'expectedCurrentSnapshotId', '42000000-0000-4000-8000-000000000099'
        )
      )::text,
      second_updated_at,
      NULL
    );
    RAISE EXCEPTION 'rollback probe failed: partially stale operation set was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ORDER_MODIFICATION_STALE_ORDER' THEN
      RAISE;
    END IF;
  END;

  EXECUTE 'DROP TABLE IF EXISTS pg_temp.touched_order_lines';
  EXECUTE 'DROP TABLE IF EXISTS pg_temp.add_correlations';

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_lines),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.order_line_removals),
    (SELECT count(*) FROM public.audit_events)
  )
  INTO after_rejection;

  IF after_rejection IS DISTINCT FROM before_rejection THEN
    RAISE EXCEPTION 'atomicity probe failed: rejected operation set persisted partial state';
  END IF;

  UPDATE public.orders
  SET status = 'READY',
      ready_at = second_updated_at
  WHERE id = target_order_id;

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.order_line_removals),
    (SELECT count(*) FROM public.audit_events)
  )
  INTO before_rejection;

  BEGIN
    PERFORM *
    FROM public.modify_pending_order(
      '42000000-0000-4000-8000-000000000001',
      target_order_id,
      second_updated_at,
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'remove',
          'lineId', grouped_line_id,
          'expectedCurrentSnapshotId',
          (SELECT current_snapshot_id FROM public.order_lines WHERE id = grouped_line_id)
        )
      )::text,
      second_updated_at,
      NULL
    );
    RAISE EXCEPTION 'state probe failed: non-PENDING order modification was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ORDER_MODIFICATION_NOT_PENDING' THEN
      RAISE;
    END IF;
  END;

  SELECT jsonb_build_array(
    public.order_active_aggregate_json(target_order_id),
    (SELECT count(*) FROM public.order_line_sale_snapshots),
    (SELECT count(*) FROM public.order_line_removals),
    (SELECT count(*) FROM public.audit_events)
  )
  INTO after_rejection;

  IF after_rejection IS DISTINCT FROM before_rejection THEN
    RAISE EXCEPTION 'atomicity probe failed: non-PENDING rejection changed state';
  END IF;
END;
$probe$;

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
