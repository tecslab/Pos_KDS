BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '49000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't049-authorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '49000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't049-unauthorized@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name) VALUES
  ('49000000-0000-4000-8000-000000000003', 't049-kitchen', 'T-049 Kitchen'),
  ('49000000-0000-4000-8000-000000000004', 't049-viewer', 'T-049 Viewer');

INSERT INTO public.permissions (id, code, name) VALUES
  ('49000000-0000-4000-8000-000000000005', 'kitchen.ready.mark', 'Mark Ready')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('49000000-0000-4000-8000-000000000001', 'T-049 Authorized', true),
  ('49000000-0000-4000-8000-000000000002', 'T-049 Unauthorized', true);

INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000003'),
  ('49000000-0000-4000-8000-000000000002', '49000000-0000-4000-8000-000000000004');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '49000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code = 'kitchen.ready.mark';

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES (
  '49000000-0000-4000-8000-000000000006',
  'T-049 Probe Restaurant', true, CURRENT_TIMESTAMP
);

INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '49000000-0000-4000-8000-000000000007',
  '49000000-0000-4000-8000-000000000006',
  'T-049 Counter', 'COUNTER', 0, true, true, CURRENT_TIMESTAMP
);

INSERT INTO public.orders (
  id, restaurant_id, service_location_id, assigned_waiter_id,
  order_number, status, total_amount, created_at, updated_at
) VALUES (
  '49000000-0000-4000-8000-000000000008',
  '49000000-0000-4000-8000-000000000006',
  '49000000-0000-4000-8000-000000000007',
  '49000000-0000-4000-8000-000000000001',
  'T049-READY-PROBE', 'PENDING', 12.00,
  transaction_timestamp() - interval '2 minutes',
  transaction_timestamp() - interval '2 minutes'
);

DO $probe$
DECLARE
  returned_status public.order_status;
  returned_ready_at timestamptz;
  audit_before bigint;
BEGIN
  BEGIN
    PERFORM * FROM public.mark_order_ready(
      '49000000-0000-4000-8000-000000000002',
      '49000000-0000-4000-8000-000000000008',
      transaction_timestamp(),
      NULL
    );
    RAISE EXCEPTION 'unauthorized Ready transition was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT status FROM public.orders WHERE id = '49000000-0000-4000-8000-000000000008') <> 'PENDING' THEN
    RAISE EXCEPTION 'unauthorized Ready transition changed order state';
  END IF;

  SELECT count(*) INTO audit_before FROM public.audit_events;
  SELECT transition.status, transition.ready_at
  INTO returned_status, returned_ready_at
  FROM public.mark_order_ready(
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000008',
    transaction_timestamp(),
    '192.0.2.49'
  ) AS transition;

  IF returned_status <> 'READY'
    OR returned_ready_at IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.orders AS ready_order
      WHERE ready_order.id = '49000000-0000-4000-8000-000000000008'
        AND ready_order.status = 'READY'
        AND ready_order.ready_at = returned_ready_at
        AND ready_order.updated_at = returned_ready_at
    )
    OR (SELECT count(*) FROM public.audit_events) <> audit_before + 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.audit_events AS audit
      WHERE audit.action = 'order.ready'
        AND audit.entity_id = '49000000-0000-4000-8000-000000000008'
        AND audit.actor_id = '49000000-0000-4000-8000-000000000001'
        AND audit.previous_values ->> 'status' = 'PENDING'
        AND audit.new_values ->> 'status' = 'READY'
        AND audit.new_values ->> 'markedReadyById' = '49000000-0000-4000-8000-000000000001'
        AND audit.source_ip = '192.0.2.49'::inet
    ) THEN
    RAISE EXCEPTION 'Ready transition did not persist state and audit';
  END IF;

  BEGIN
    PERFORM * FROM public.mark_order_ready(
      '49000000-0000-4000-8000-000000000001',
      '49000000-0000-4000-8000-000000000008',
      transaction_timestamp(),
      NULL
    );
    RAISE EXCEPTION 'duplicate Ready transition was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ORDER_READY_NOT_PENDING%' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.audit_events) <> audit_before + 1 THEN
    RAISE EXCEPTION 'duplicate Ready transition appended audit history';
  END IF;
END;
$probe$;

ROLLBACK;
