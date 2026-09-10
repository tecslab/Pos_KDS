BEGIN;

SET CONSTRAINTS ALL DEFERRED;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '68000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    't068-reporter@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    '68000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    't068-observer@example.invalid', '', CURRENT_TIMESTAMP,
    '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO public.roles (id, code, name) VALUES
  ('68000000-0000-4000-8000-000000000003', 't068-reporter', 'T-068 Reporter'),
  ('68000000-0000-4000-8000-000000000004', 't068-observer', 'T-068 Observer');

INSERT INTO public.application_users (id, display_name, is_active) VALUES
  ('68000000-0000-4000-8000-000000000001', 'T-068 Reporter', true),
  ('68000000-0000-4000-8000-000000000002', 'T-068 Observer', true);

INSERT INTO public.user_role_assignments (user_id, role_id) VALUES
  ('68000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000003'),
  ('68000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000004');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '68000000-0000-4000-8000-000000000003', permission.id
FROM public.permissions AS permission
WHERE permission.code = 'reports.view';

INSERT INTO public.restaurants (id, name, is_active, updated_at) VALUES (
  '68000000-0000-4000-8000-000000000010',
  'T-068 Report Restaurant', true, transaction_timestamp()
);
INSERT INTO public.service_locations (
  id, restaurant_id, name, type, display_order, is_active,
  allows_multiple_active_orders, updated_at
) VALUES (
  '68000000-0000-4000-8000-000000000011',
  '68000000-0000-4000-8000-000000000010',
  'T-068 Counter', 'COUNTER', 0, true, true, transaction_timestamp()
);
INSERT INTO public.restaurant_tax_rates (
  id, restaurant_id, code, name, rate, is_active, updated_at
) VALUES (
  '68000000-0000-4000-8000-000000000016',
  '68000000-0000-4000-8000-000000000010',
  'T068', 'T-068 Tax', 0, true, transaction_timestamp()
);
INSERT INTO public.product_catalogs (restaurant_id, name, is_active, updated_at)
VALUES (
  '68000000-0000-4000-8000-000000000010',
  'T-068 Catalog', true, transaction_timestamp()
);
INSERT INTO public.product_categories (
  id, restaurant_id, name, display_order, is_active, updated_at
) VALUES (
  '68000000-0000-4000-8000-000000000017',
  '68000000-0000-4000-8000-000000000010',
  'T-068 Category', 0, true, transaction_timestamp()
);
INSERT INTO public.products (
  id, restaurant_id, category_id, display_order, is_active, updated_at
) VALUES (
  '68000000-0000-4000-8000-000000000018',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000017', 0, true,
  transaction_timestamp()
);
INSERT INTO public.product_versions (
  id, restaurant_id, product_id, version_number, name, unit_price,
  printer_alias, tax_rate_id, tax_code, tax_name, tax_rate,
  price_includes_tax, resale_inventory_item_id
) VALUES (
  '68000000-0000-4000-8000-000000000019',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000018', 1,
  'T-068 Product', 10.00, 'T068-PRODUCT',
  '68000000-0000-4000-8000-000000000016',
  'T068', 'T-068 Tax', 0, true, NULL
);
INSERT INTO public.payment_methods (
  id, restaurant_id, code, name, display_order, is_active, updated_at
) VALUES (
  '68000000-0000-4000-8000-000000000012',
  '68000000-0000-4000-8000-000000000010',
  't068_cash', 'T-068 Cash Snapshot', 0, true, transaction_timestamp()
);
INSERT INTO public.orders (
  id, restaurant_id, service_location_id, assigned_waiter_id, order_number,
  status, total_amount, created_at, updated_at
) VALUES (
  '68000000-0000-4000-8000-000000000013',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000011',
  '68000000-0000-4000-8000-000000000001',
  'T068-REPORT-PROBE', 'PENDING', 20.00,
  (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
    AT TIME ZONE 'America/Guayaquil') - interval '1 hour',
  (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
    AT TIME ZONE 'America/Guayaquil') - interval '1 hour'
);
INSERT INTO public.customer_baskets (
  id, restaurant_id, order_id, status, total_amount, created_at
) VALUES (
  '68000000-0000-4000-8000-000000000014',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000013',
  'PENDING', 20.00,
  (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
    AT TIME ZONE 'America/Guayaquil') - interval '1 hour'
);
INSERT INTO public.order_lines (
  id, restaurant_id, basket_id, current_snapshot_id, created_at
) VALUES (
  '68000000-0000-4000-8000-000000000020',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000014',
  '68000000-0000-4000-8000-000000000021',
  (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
    AT TIME ZONE 'America/Guayaquil') - interval '1 hour'
);
INSERT INTO public.order_line_sale_snapshots (
  id, restaurant_id, order_line_id, revision_number, product_version_id,
  product_name, quantity, base_unit_price, final_unit_price, line_total,
  tax_code, tax_name, tax_rate, price_includes_tax, selected_options,
  removed_ingredients, observations, created_at
) VALUES (
  '68000000-0000-4000-8000-000000000021',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000020', 1,
  '68000000-0000-4000-8000-000000000019',
  'T-068 Product', 2, 10.00, 10.00, 20.00,
  'T068', 'T-068 Tax', 0, true, '[]'::jsonb, '[]'::jsonb, NULL,
  (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
    AT TIME ZONE 'America/Guayaquil') - interval '1 hour'
);
INSERT INTO public.payments (
  id, restaurant_id, basket_id, payment_method_id, recorded_by_id,
  amount, payment_method_code, payment_method_name, reference_number,
  comments, recorded_at
) VALUES (
  '68000000-0000-4000-8000-000000000015',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000014',
  '68000000-0000-4000-8000-000000000012',
  '68000000-0000-4000-8000-000000000001',
  5.00, 't068_cash', 'T-068 Cash Snapshot', 'T068-REF',
  'rollback-only payment history',
  (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
    AT TIME ZONE 'America/Guayaquil') - interval '30 minutes'
);

CREATE TEMP TABLE t068_counts_before AS
SELECT
  (SELECT count(*) FROM public.payments) AS payments,
  (SELECT count(*) FROM public.customer_baskets) AS baskets,
  (SELECT count(*) FROM public.orders) AS orders;

CREATE TEMP TABLE t068_report_result AS
SELECT * FROM public.read_payment_report(
  '68000000-0000-4000-8000-000000000001',
  '68000000-0000-4000-8000-000000000010',
  (transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date - 1,
  'America/Guayaquil'
);

DO $probe$
DECLARE
  result_row record;
BEGIN
  SELECT * INTO result_row FROM t068_report_result;
  IF result_row.restaurant_id IS DISTINCT FROM '68000000-0000-4000-8000-000000000010'::uuid
    OR result_row.total_revenue IS DISTINCT FROM '5.00'
    OR result_row.total_outstanding IS DISTINCT FROM '15.00'
    OR jsonb_array_length(result_row.revenue_by_method) <> 1
    OR result_row.revenue_by_method->0->>'payment_method_name' IS DISTINCT FROM 'T-068 Cash Snapshot'
    OR jsonb_array_length(result_row.outstanding_balances) <> 1
    OR result_row.outstanding_balances->0->>'outstanding_balance' IS DISTINCT FROM '15.00'
    OR jsonb_array_length(result_row.partial_payments) <> 1
    OR result_row.partial_payments->0->>'paid_amount' IS DISTINCT FROM '5.00'
    OR jsonb_array_length(result_row.payment_history) <> 1
    OR result_row.payment_history->0->>'reference_number' IS DISTINCT FROM 'T068-REF' THEN
    RAISE EXCEPTION 'payment report totals, history, or balances were incorrect';
  END IF;

  BEGIN
    PERFORM * FROM public.read_payment_report(
      '68000000-0000-4000-8000-000000000002',
      '68000000-0000-4000-8000-000000000010',
      (transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date - 1,
      'America/Guayaquil'
    );
    RAISE EXCEPTION 'expected reports.view denial';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF has_function_privilege(
    'authenticated',
    'public.read_payment_report(uuid,uuid,date,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated retained direct payment report execution';
  END IF;
END;
$probe$;

-- Simulate a pending-order edit after the selected historical day closed. The
-- mutable aggregate becomes 30.00, while revision 1 remains the 20.00 state at
-- the selected cutoff.
INSERT INTO public.order_line_sale_snapshots (
  id, restaurant_id, order_line_id, revision_number, product_version_id,
  product_name, quantity, base_unit_price, final_unit_price, line_total,
  tax_code, tax_name, tax_rate, price_includes_tax, selected_options,
  removed_ingredients, observations, created_at
) VALUES (
  '68000000-0000-4000-8000-000000000022',
  '68000000-0000-4000-8000-000000000010',
  '68000000-0000-4000-8000-000000000020', 2,
  '68000000-0000-4000-8000-000000000019',
  'T-068 Product', 3, 10.00, 10.00, 30.00,
  'T068', 'T-068 Tax', 0, true, '[]'::jsonb, '[]'::jsonb,
  'post-cutoff modification',
  (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
    AT TIME ZONE 'America/Guayaquil') + interval '1 hour'
);
UPDATE public.order_lines
SET current_snapshot_id = '68000000-0000-4000-8000-000000000022'
WHERE id = '68000000-0000-4000-8000-000000000020';
UPDATE public.customer_baskets
SET total_amount = 30.00
WHERE id = '68000000-0000-4000-8000-000000000014';
UPDATE public.orders
SET total_amount = 30.00,
    updated_at = (((transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date)::timestamp
      AT TIME ZONE 'America/Guayaquil') + interval '1 hour'
WHERE id = '68000000-0000-4000-8000-000000000013';

UPDATE public.payment_methods
SET name = 'T-068 Renamed Current Method', updated_at = transaction_timestamp()
WHERE id = '68000000-0000-4000-8000-000000000012';

DO $probe$
DECLARE
  result_row record;
  before_row record;
BEGIN
  SELECT * INTO result_row FROM public.read_payment_report(
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000010',
    (transaction_timestamp() AT TIME ZONE 'America/Guayaquil')::date - 1,
    'America/Guayaquil'
  );
  IF result_row.revenue_by_method->0->>'payment_method_name'
    IS DISTINCT FROM 'T-068 Cash Snapshot' THEN
    RAISE EXCEPTION 'payment method snapshot was not preserved';
  END IF;
  IF result_row.total_outstanding IS DISTINCT FROM '15.00'
    OR result_row.outstanding_balances->0->>'basket_total' IS DISTINCT FROM '20.00'
    OR result_row.partial_payments->0->>'outstanding_balance' IS DISTINCT FROM '15.00' THEN
    RAISE EXCEPTION 'post-cutoff modification changed the historical balance';
  END IF;

  SELECT * INTO before_row FROM t068_counts_before;
  IF (SELECT count(*) FROM public.payments) <> before_row.payments
    OR (SELECT count(*) FROM public.customer_baskets) <> before_row.baskets
    OR (SELECT count(*) FROM public.orders) <> before_row.orders THEN
    RAISE EXCEPTION 'payment report unexpectedly mutated persisted data';
  END IF;
END;
$probe$;

ROLLBACK;
