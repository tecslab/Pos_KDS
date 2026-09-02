BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '52000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't052-authorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '52000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't052-unauthorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name) VALUES
  ('52000000-0000-4000-8000-000000000003', 't052-delivery', 'T-052 Delivery'),
  ('52000000-0000-4000-8000-000000000004', 't052-viewer', 'T-052 Viewer');

INSERT INTO public.permissions (id, code, name) VALUES
  ('52000000-0000-4000-8000-000000000005', 'delivery.on_the_way.mark', 'Mark On the Way')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('52000000-0000-4000-8000-000000000001', 'T-052 Authorized', true),
  ('52000000-0000-4000-8000-000000000002', 'T-052 Unauthorized', true);

INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('52000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000003'),
  ('52000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000004');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '52000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code = 'delivery.on_the_way.mark';

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES (
  '52000000-0000-4000-8000-000000000006',
  'T-052 Probe Restaurant', true, CURRENT_TIMESTAMP
);

INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '52000000-0000-4000-8000-000000000007',
  '52000000-0000-4000-8000-000000000006',
  'T-052 Counter', 'COUNTER', 0, true, true, CURRENT_TIMESTAMP
);

INSERT INTO public.orders (
  id, restaurant_id, service_location_id, assigned_waiter_id,
  order_number, status, total_amount, created_at, ready_at, updated_at
) VALUES (
  '52000000-0000-4000-8000-000000000008',
  '52000000-0000-4000-8000-000000000006',
  '52000000-0000-4000-8000-000000000007',
  '52000000-0000-4000-8000-000000000001',
  'T052-HANDOFF-PROBE', 'READY', 12.00,
  transaction_timestamp() - interval '3 minutes',
  transaction_timestamp() - interval '2 minutes',
  transaction_timestamp() - interval '2 minutes'
);

DO $probe$
DECLARE
  returned_status public.order_status;
  returned_collected_by_id uuid;
  returned_on_the_way_at timestamptz;
  audit_before bigint;
BEGIN
  BEGIN
    PERFORM * FROM public.mark_order_on_the_way(
      '52000000-0000-4000-8000-000000000002',
      '52000000-0000-4000-8000-000000000008',
      transaction_timestamp(),
      NULL
    );
    RAISE EXCEPTION 'unauthorized On-the-Way transition was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT status FROM public.orders WHERE id = '52000000-0000-4000-8000-000000000008') <> 'READY' THEN
    RAISE EXCEPTION 'unauthorized On-the-Way transition changed order state';
  END IF;

  SELECT count(*) INTO audit_before FROM public.audit_events;
  SELECT transition.status, transition.collected_by_id, transition.on_the_way_at
  INTO returned_status, returned_collected_by_id, returned_on_the_way_at
  FROM public.mark_order_on_the_way(
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000008',
    transaction_timestamp(),
    '192.0.2.52'
  ) AS transition;

  IF returned_status <> 'ON_THE_WAY'
    OR returned_collected_by_id <> '52000000-0000-4000-8000-000000000001'
    OR returned_on_the_way_at IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.orders AS handed_off_order
      WHERE handed_off_order.id = '52000000-0000-4000-8000-000000000008'
        AND handed_off_order.status = 'ON_THE_WAY'
        AND handed_off_order.on_the_way_at = returned_on_the_way_at
        AND handed_off_order.updated_at = returned_on_the_way_at
    )
    OR (SELECT count(*) FROM public.audit_events) <> audit_before + 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.audit_events AS audit
      WHERE audit.action = 'order.on-the-way'
        AND audit.entity_id = '52000000-0000-4000-8000-000000000008'
        AND audit.actor_id = '52000000-0000-4000-8000-000000000001'
        AND audit.previous_values ->> 'status' = 'READY'
        AND audit.new_values ->> 'status' = 'ON_THE_WAY'
        AND audit.new_values ->> 'collectedById' = '52000000-0000-4000-8000-000000000001'
        AND audit.source_ip = '192.0.2.52'::inet
    ) THEN
    RAISE EXCEPTION 'On-the-Way transition did not persist state and audit';
  END IF;

  BEGIN
    PERFORM * FROM public.mark_order_on_the_way(
      '52000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000008',
      transaction_timestamp(),
      NULL
    );
    RAISE EXCEPTION 'duplicate On-the-Way transition was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ORDER_ON_THE_WAY_NOT_READY%' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.audit_events) <> audit_before + 1 THEN
    RAISE EXCEPTION 'duplicate On-the-Way transition appended audit history';
  END IF;
END;
$probe$;

ROLLBACK;
