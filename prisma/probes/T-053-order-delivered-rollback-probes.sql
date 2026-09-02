BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '53000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't053-authorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '53000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't053-unauthorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name) VALUES
  ('53000000-0000-4000-8000-000000000003', 't053-delivery', 'T-053 Delivery'),
  ('53000000-0000-4000-8000-000000000004', 't053-viewer', 'T-053 Viewer');

INSERT INTO public.permissions (id, code, name) VALUES
  ('53000000-0000-4000-8000-000000000005', 'delivery.delivered.mark', 'Mark Delivered')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('53000000-0000-4000-8000-000000000001', 'T-053 Authorized', true),
  ('53000000-0000-4000-8000-000000000002', 'T-053 Unauthorized', true);

INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('53000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003'),
  ('53000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000004');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '53000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code = 'delivery.delivered.mark';

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES (
  '53000000-0000-4000-8000-000000000006',
  'T-053 Probe Restaurant', true, CURRENT_TIMESTAMP
);

INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '53000000-0000-4000-8000-000000000007',
  '53000000-0000-4000-8000-000000000006',
  'T-053 Counter', 'COUNTER', 0, true, true, CURRENT_TIMESTAMP
);

INSERT INTO public.orders (
  id, restaurant_id, service_location_id, assigned_waiter_id,
  order_number, status, total_amount, created_at, ready_at, on_the_way_at,
  updated_at
) VALUES (
  '53000000-0000-4000-8000-000000000008',
  '53000000-0000-4000-8000-000000000006',
  '53000000-0000-4000-8000-000000000007',
  '53000000-0000-4000-8000-000000000001',
  'T053-DELIVERY-PROBE', 'ON_THE_WAY', 12.00,
  transaction_timestamp() - interval '4 minutes',
  transaction_timestamp() - interval '3 minutes',
  transaction_timestamp() - interval '2 minutes',
  transaction_timestamp() - interval '2 minutes'
);

DO $probe$
DECLARE
  returned_status public.order_status;
  returned_delivered_by_id uuid;
  returned_delivered_at timestamptz;
  audit_before bigint;
BEGIN
  BEGIN
    PERFORM * FROM public.mark_order_delivered(
      '53000000-0000-4000-8000-000000000002',
      '53000000-0000-4000-8000-000000000008',
      transaction_timestamp(),
      NULL
    );
    RAISE EXCEPTION 'unauthorized Delivered transition was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT status FROM public.orders WHERE id = '53000000-0000-4000-8000-000000000008') <> 'ON_THE_WAY' THEN
    RAISE EXCEPTION 'unauthorized Delivered transition changed order state';
  END IF;

  SELECT count(*) INTO audit_before FROM public.audit_events;
  SELECT transition.status, transition.delivered_by_id, transition.delivered_at
  INTO returned_status, returned_delivered_by_id, returned_delivered_at
  FROM public.mark_order_delivered(
    '53000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000008',
    transaction_timestamp(),
    '192.0.2.53'
  ) AS transition;

  IF returned_status <> 'DELIVERED'
    OR returned_delivered_by_id <> '53000000-0000-4000-8000-000000000001'
    OR returned_delivered_at IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.orders AS delivered_order
      WHERE delivered_order.id = '53000000-0000-4000-8000-000000000008'
        AND delivered_order.status = 'DELIVERED'
        AND delivered_order.delivered_at = returned_delivered_at
        AND delivered_order.updated_at = returned_delivered_at
    )
    OR (SELECT count(*) FROM public.audit_events) <> audit_before + 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.audit_events AS audit
      WHERE audit.action = 'order.delivered'
        AND audit.entity_id = '53000000-0000-4000-8000-000000000008'
        AND audit.actor_id = '53000000-0000-4000-8000-000000000001'
        AND audit.previous_values ->> 'status' = 'ON_THE_WAY'
        AND audit.new_values ->> 'status' = 'DELIVERED'
        AND audit.new_values ->> 'deliveredById' = '53000000-0000-4000-8000-000000000001'
        AND audit.source_ip = '192.0.2.53'::inet
    ) THEN
    RAISE EXCEPTION 'Delivered transition did not persist state and audit';
  END IF;

  BEGIN
    PERFORM * FROM public.mark_order_delivered(
      '53000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000008',
      transaction_timestamp(),
      NULL
    );
    RAISE EXCEPTION 'duplicate Delivered transition was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ORDER_DELIVERED_NOT_ON_THE_WAY%' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.audit_events) <> audit_before + 1 THEN
    RAISE EXCEPTION 'duplicate Delivered transition appended audit history';
  END IF;
END;
$probe$;

ROLLBACK;
