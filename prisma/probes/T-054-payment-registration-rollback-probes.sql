BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '54000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't054-admin@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '54000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't054-waiter@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('54000000-0000-4000-8000-000000000001', 'T-054 Admin', true),
  ('54000000-0000-4000-8000-000000000002', 'T-054 Waiter', true);

INSERT INTO public.user_role_assignments (user_id, role_id)
SELECT '54000000-0000-4000-8000-000000000001', role.id
FROM public.roles AS role WHERE role.code = 'administrator';
INSERT INTO public.user_role_assignments (user_id, role_id)
SELECT '54000000-0000-4000-8000-000000000002', role.id
FROM public.roles AS role WHERE role.code = 'waiter';

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES (
  '54000000-0000-4000-8000-000000000003',
  'T-054 Probe Restaurant', true, transaction_timestamp()
);
INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '54000000-0000-4000-8000-000000000004',
  '54000000-0000-4000-8000-000000000003',
  'T-054 Counter', 'COUNTER', 0, true, true, transaction_timestamp()
);
INSERT INTO public.payment_methods (
  id, restaurant_id, code, name, display_order, is_active, updated_at
) VALUES (
  '54000000-0000-4000-8000-000000000005',
  '54000000-0000-4000-8000-000000000003',
  't054_cash', 'T-054 Cash', 0, true, transaction_timestamp()
);

INSERT INTO public.orders (
  id, restaurant_id, service_location_id, assigned_waiter_id, order_number,
  status, total_amount, created_at, updated_at
) VALUES
  (
    '54000000-0000-4000-8000-000000000006',
    '54000000-0000-4000-8000-000000000003',
    '54000000-0000-4000-8000-000000000004',
    '54000000-0000-4000-8000-000000000002',
    'T054-PAYMENT-PROBE-1', 'PENDING', 17.00,
    transaction_timestamp() - interval '5 minutes',
    transaction_timestamp() - interval '5 minutes'
  ),
  (
    '54000000-0000-4000-8000-000000000009',
    '54000000-0000-4000-8000-000000000003',
    '54000000-0000-4000-8000-000000000004',
    '54000000-0000-4000-8000-000000000002',
    'T054-PAYMENT-PROBE-2', 'PENDING', 5.00,
    transaction_timestamp() - interval '5 minutes',
    transaction_timestamp() - interval '5 minutes'
  );

UPDATE public.orders
SET status = 'READY',
    ready_at = transaction_timestamp() - interval '4 minutes',
    updated_at = transaction_timestamp() - interval '4 minutes'
WHERE id IN (
  '54000000-0000-4000-8000-000000000006',
  '54000000-0000-4000-8000-000000000009'
);
UPDATE public.orders
SET status = 'ON_THE_WAY',
    on_the_way_at = transaction_timestamp() - interval '3 minutes',
    updated_at = transaction_timestamp() - interval '3 minutes'
WHERE id IN (
  '54000000-0000-4000-8000-000000000006',
  '54000000-0000-4000-8000-000000000009'
);
UPDATE public.orders
SET status = 'DELIVERED',
    delivered_at = transaction_timestamp() - interval '2 minutes',
    updated_at = transaction_timestamp() - interval '2 minutes'
WHERE id IN (
  '54000000-0000-4000-8000-000000000006',
  '54000000-0000-4000-8000-000000000009'
);

INSERT INTO public.customer_baskets (
  id, restaurant_id, order_id, status, total_amount, created_at
) VALUES
  (
    '54000000-0000-4000-8000-000000000007',
    '54000000-0000-4000-8000-000000000003',
    '54000000-0000-4000-8000-000000000006',
    'PENDING', 10.00, transaction_timestamp() - interval '5 minutes'
  ),
  (
    '54000000-0000-4000-8000-000000000008',
    '54000000-0000-4000-8000-000000000003',
    '54000000-0000-4000-8000-000000000006',
    'PENDING', 7.00, transaction_timestamp() - interval '5 minutes'
  ),
  (
    '54000000-0000-4000-8000-000000000010',
    '54000000-0000-4000-8000-000000000003',
    '54000000-0000-4000-8000-000000000009',
    'PENDING', 5.00, transaction_timestamp() - interval '5 minutes'
  );

DO $probe$
DECLARE
  partial_payment_id uuid;
  exact_payment_id uuid;
  overage_payment_id uuid;
  result_row record;
  payment_count_before bigint;
  audit_count_before bigint;
BEGIN
  SELECT * INTO result_row FROM public.register_payment(
    '54000000-0000-4000-8000-000000000002',
    '54000000-0000-4000-8000-000000000007',
    '54000000-0000-4000-8000-000000000005',
    4.00, ' PARTIAL-1 ', ' first payment ', NULL,
    transaction_timestamp(), '192.0.2.54'
  );
  partial_payment_id := result_row.payment_id;
  IF result_row.basket_status <> 'PENDING'
    OR result_row.basket_paid_amount <> 4.00
    OR result_row.basket_outstanding_balance <> 6.00
    OR result_row.order_status <> 'DELIVERED'
    OR NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE id = partial_payment_id
        AND amount = 4.00
        AND payment_method_code = 't054_cash'
        AND reference_number = 'PARTIAL-1'
        AND comments = 'first payment'
        AND overage_authorized_by_id IS NULL
    ) THEN
    RAISE EXCEPTION 'partial basket payment did not persist correctly';
  END IF;

  SELECT * INTO result_row FROM public.register_payment(
    '54000000-0000-4000-8000-000000000002',
    '54000000-0000-4000-8000-000000000007',
    '54000000-0000-4000-8000-000000000005',
    6.00, NULL, NULL, NULL, transaction_timestamp(), NULL
  );
  exact_payment_id := result_row.payment_id;
  IF result_row.basket_status <> 'PAID'
    OR result_row.basket_outstanding_balance <> 0.00
    OR result_row.order_status <> 'DELIVERED'
    OR (SELECT status FROM public.customer_baskets
        WHERE id = '54000000-0000-4000-8000-000000000007') <> 'PAID'
    OR (SELECT status FROM public.orders
        WHERE id = '54000000-0000-4000-8000-000000000006') <> 'DELIVERED' THEN
    RAISE EXCEPTION 'exact basket settlement changed the wrong aggregate state';
  END IF;

  BEGIN
    PERFORM * FROM public.register_payment(
      '54000000-0000-4000-8000-000000000002',
      '54000000-0000-4000-8000-000000000008',
      '54000000-0000-4000-8000-000000000005',
      8.00, NULL, NULL, 'Waiter may not approve', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'unprivileged overage was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%PAYMENT_OVERAGE_UNAUTHORIZED%' THEN RAISE; END IF;
  END;

  SELECT * INTO result_row FROM public.register_payment(
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000008',
    '54000000-0000-4000-8000-000000000005',
    8.00, NULL, NULL, ' Customer requested cash overage ',
    transaction_timestamp(), NULL
  );
  overage_payment_id := result_row.payment_id;
  IF result_row.basket_status <> 'PAID'
    OR result_row.basket_paid_amount <> 8.00
    OR result_row.basket_outstanding_balance <> 0.00
    OR result_row.order_status <> 'PAID'
    OR result_row.order_paid_at IS NULL
    OR result_row.overage_authorized_by_id <> '54000000-0000-4000-8000-000000000001'
    OR result_row.overage_authorized_at <> result_row.recorded_at
    OR result_row.overage_reason <> 'Customer requested cash overage'
    OR NOT EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE action = 'payment.registered'
        AND entity_id = overage_payment_id::text
        AND actor_id = '54000000-0000-4000-8000-000000000001'
        AND new_values ->> 'overageReason' = 'Customer requested cash overage'
        AND (new_values ->> 'overageAmount')::numeric = 1.00
        AND (new_values ->> 'basketOutstandingBefore')::numeric = 7.00
        AND new_values ->> 'orderStatus' = 'PAID'
    ) THEN
    RAISE EXCEPTION 'authorized overage or all-basket settlement evidence is incomplete';
  END IF;

  SELECT count(*) INTO payment_count_before FROM public.payments;
  SELECT count(*) INTO audit_count_before FROM public.audit_events;
  BEGIN
    PERFORM * FROM public.register_payment(
      '54000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000008',
      '54000000-0000-4000-8000-000000000005',
      1.00, NULL, NULL, 'Already paid', transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'payment after Paid was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%PAYMENT_ORDER_NOT_DELIVERED%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.payments) <> payment_count_before
    OR (SELECT count(*) FROM public.audit_events) <> audit_count_before THEN
    RAISE EXCEPTION 'rejected Paid-order payment changed immutable history';
  END IF;

  BEGIN
    UPDATE public.payments SET amount = 1.00 WHERE id = partial_payment_id;
    RAISE EXCEPTION 'payment history mutation was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE public.audit_events SET action = 'changed'
    WHERE entity_id = exact_payment_id::text;
    RAISE EXCEPTION 'audit history mutation was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END;
$probe$;

CREATE FUNCTION pg_temp.reject_t054_payment_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'payment.registered' THEN
    RAISE EXCEPTION 'T054_FORCED_AUDIT_FAILURE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER t054_force_payment_audit_failure
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_t054_payment_audit();

DO $probe$
DECLARE
  payment_count_before bigint;
  audit_count_before bigint;
BEGIN
  SELECT count(*) INTO payment_count_before FROM public.payments;
  SELECT count(*) INTO audit_count_before FROM public.audit_events;
  BEGIN
    PERFORM * FROM public.register_payment(
      '54000000-0000-4000-8000-000000000002',
      '54000000-0000-4000-8000-000000000010',
      '54000000-0000-4000-8000-000000000005',
      5.00, NULL, NULL, NULL, transaction_timestamp(), NULL
    );
    RAISE EXCEPTION 'forced audit failure did not abort payment registration';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%T054_FORCED_AUDIT_FAILURE%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.payments) <> payment_count_before
    OR (SELECT count(*) FROM public.audit_events) <> audit_count_before
    OR (SELECT status FROM public.customer_baskets
        WHERE id = '54000000-0000-4000-8000-000000000010') <> 'PENDING'
    OR (SELECT paid_at FROM public.customer_baskets
        WHERE id = '54000000-0000-4000-8000-000000000010') IS NOT NULL
    OR (SELECT status FROM public.orders
        WHERE id = '54000000-0000-4000-8000-000000000009') <> 'DELIVERED' THEN
    RAISE EXCEPTION 'audit failure did not roll back payment and settlement atomically';
  END IF;
END;
$probe$;

ROLLBACK;
