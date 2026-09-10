CREATE OR REPLACE FUNCTION public.read_payment_report(
  actor_user_id uuid,
  target_restaurant_id uuid,
  report_date date,
  reporting_timezone text
)
RETURNS TABLE (
  restaurant_id uuid,
  restaurant_name text,
  report_date_result text,
  reporting_timezone_result text,
  period_start timestamptz,
  period_end timestamptz,
  total_revenue text,
  total_outstanding text,
  revenue_by_method jsonb,
  outstanding_balances jsonb,
  partial_payments jsonb,
  payment_history jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requested_period_start timestamptz;
  requested_period_end timestamptz;
BEGIN
  IF actor_user_id IS NULL
    OR target_restaurant_id IS NULL
    OR report_date IS NULL
    OR reporting_timezone IS DISTINCT FROM 'America/Guayaquil' THEN
    RAISE EXCEPTION 'Payment report input is invalid' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.application_users AS application_user
    JOIN public.user_role_assignments AS assignment
      ON assignment.user_id = application_user.id
    JOIN public.role_permissions AS role_permission
      ON role_permission.role_id = assignment.role_id
    JOIN public.permissions AS permission
      ON permission.id = role_permission.permission_id
    WHERE application_user.id = actor_user_id
      AND application_user.is_active = true
      AND permission.code = 'reports.view'
  ) THEN
    RAISE EXCEPTION 'Payment report is unauthorized' USING ERRCODE = '42501';
  END IF;

  requested_period_start := report_date::timestamp AT TIME ZONE reporting_timezone;
  requested_period_end := (report_date + 1)::timestamp AT TIME ZONE reporting_timezone;

  RETURN QUERY
  WITH requested_restaurant AS (
    SELECT restaurant.id, restaurant.name
    FROM public.restaurants AS restaurant
    WHERE restaurant.id = target_restaurant_id
      AND restaurant.is_active = true
      AND restaurant.deleted_at IS NULL
  ),
  day_payments AS (
    SELECT
      payment.id,
      payment.basket_id,
      payment.amount,
      payment.payment_method_code,
      payment.payment_method_name,
      payment.recorded_by_id,
      payment.recorded_at,
      payment.reference_number,
      payment.comments,
      payment.overage_authorized_by_id,
      payment.overage_authorized_at,
      payment.overage_reason,
      sale_order.id AS order_id,
      sale_order.order_number
    FROM public.payments AS payment
    JOIN public.customer_baskets AS basket
      ON basket.restaurant_id = payment.restaurant_id
     AND basket.id = payment.basket_id
    JOIN public.orders AS sale_order
      ON sale_order.restaurant_id = basket.restaurant_id
     AND sale_order.id = basket.order_id
    WHERE payment.restaurant_id = target_restaurant_id
      AND payment.recorded_at >= requested_period_start
      AND payment.recorded_at < requested_period_end
  ),
  method_totals AS (
    SELECT
      payment.payment_method_code,
      payment.payment_method_name,
      COUNT(*)::bigint AS payment_count,
      SUM(payment.amount) AS amount
    FROM day_payments AS payment
    GROUP BY payment.payment_method_code, payment.payment_method_name
  ),
  method_totals_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'payment_method_code', method.payment_method_code,
      'payment_method_name', method.payment_method_name,
      'payment_count', method.payment_count,
      'amount', to_char(method.amount, 'FM9999999990.00')
    ) ORDER BY method.amount DESC, method.payment_method_name, method.payment_method_code), '[]'::jsonb) AS value
    FROM method_totals AS method
  ),
  -- Reconstruct the basket at the reporting cutoff from append-only line
  -- revisions and immutable removal evidence. customer_baskets.total_amount is
  -- intentionally not used because pending-order edits can change it later.
  active_line_snapshots_at_period_end AS (
    SELECT DISTINCT ON (line.id)
      sale_order.id AS order_id,
      sale_order.order_number,
      basket.id AS basket_id,
      snapshot.line_total
    FROM public.order_lines AS line
    JOIN public.customer_baskets AS basket
      ON basket.restaurant_id = line.restaurant_id
     AND basket.id = line.basket_id
    JOIN public.orders AS sale_order
      ON sale_order.restaurant_id = basket.restaurant_id
     AND sale_order.id = basket.order_id
    JOIN public.order_line_sale_snapshots AS snapshot
      ON snapshot.restaurant_id = line.restaurant_id
     AND snapshot.order_line_id = line.id
     AND snapshot.created_at < requested_period_end
    LEFT JOIN public.order_line_removals AS removal
      ON removal.restaurant_id = line.restaurant_id
     AND removal.order_line_id = line.id
     AND removal.removed_at < requested_period_end
    LEFT JOIN public.order_cancellations AS cancellation
      ON cancellation.restaurant_id = sale_order.restaurant_id
     AND cancellation.order_id = sale_order.id
     AND cancellation.cancelled_at < requested_period_end
    WHERE line.restaurant_id = target_restaurant_id
      AND line.created_at < requested_period_end
      AND basket.created_at < requested_period_end
      AND sale_order.created_at < requested_period_end
      AND removal.order_line_id IS NULL
      AND cancellation.order_id IS NULL
    ORDER BY
      line.id,
      snapshot.created_at DESC,
      snapshot.revision_number DESC,
      snapshot.id DESC
  ),
  historical_basket_totals AS (
    SELECT
      snapshot.order_id,
      snapshot.order_number,
      snapshot.basket_id,
      SUM(snapshot.line_total) AS basket_total
    FROM active_line_snapshots_at_period_end AS snapshot
    GROUP BY snapshot.order_id, snapshot.order_number, snapshot.basket_id
  ),
  balances_as_of_period_end AS (
    SELECT
      historical.order_id,
      historical.order_number,
      historical.basket_id,
      historical.basket_total,
      COALESCE(SUM(payment.amount), 0::numeric) AS paid_amount
    FROM historical_basket_totals AS historical
    LEFT JOIN public.payments AS payment
      ON payment.restaurant_id = target_restaurant_id
     AND payment.basket_id = historical.basket_id
     AND payment.recorded_at < requested_period_end
    GROUP BY
      historical.order_id,
      historical.order_number,
      historical.basket_id,
      historical.basket_total
  ),
  outstanding AS (
    SELECT balance.*,
      GREATEST(balance.basket_total - balance.paid_amount, 0::numeric) AS outstanding_balance
    FROM balances_as_of_period_end AS balance
    WHERE GREATEST(balance.basket_total - balance.paid_amount, 0::numeric) > 0
  ),
  outstanding_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'order_id', balance.order_id,
      'order_number', balance.order_number,
      'basket_id', balance.basket_id,
      'basket_total', to_char(balance.basket_total, 'FM9999999990.00'),
      'paid_amount', to_char(balance.paid_amount, 'FM9999999990.00'),
      'outstanding_balance', to_char(balance.outstanding_balance, 'FM9999999990.00')
    ) ORDER BY balance.outstanding_balance DESC, balance.order_number, balance.basket_id), '[]'::jsonb) AS value
    FROM outstanding AS balance
  ),
  partial_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'order_id', balance.order_id,
      'order_number', balance.order_number,
      'basket_id', balance.basket_id,
      'basket_total', to_char(balance.basket_total, 'FM9999999990.00'),
      'paid_amount', to_char(balance.paid_amount, 'FM9999999990.00'),
      'outstanding_balance', to_char(balance.outstanding_balance, 'FM9999999990.00')
    ) ORDER BY balance.outstanding_balance DESC, balance.order_number, balance.basket_id), '[]'::jsonb) AS value
    FROM outstanding AS balance
    WHERE balance.paid_amount > 0
  ),
  payment_history_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', payment.id,
      'order_id', payment.order_id,
      'order_number', payment.order_number,
      'basket_id', payment.basket_id,
      'amount', to_char(payment.amount, 'FM9999999990.00'),
      'payment_method_code', payment.payment_method_code,
      'payment_method_name', payment.payment_method_name,
      'recorded_by_id', payment.recorded_by_id,
      'recorded_at', payment.recorded_at,
      'reference_number', payment.reference_number,
      'comments', payment.comments,
      'overage_authorized_by_id', payment.overage_authorized_by_id,
      'overage_authorized_at', payment.overage_authorized_at,
      'overage_reason', payment.overage_reason
    ) ORDER BY payment.recorded_at DESC, payment.id DESC), '[]'::jsonb) AS value
    FROM day_payments AS payment
  ),
  summary AS (
    SELECT
      COALESCE((SELECT SUM(payment.amount) FROM day_payments AS payment), 0::numeric) AS total_revenue,
      COALESCE((SELECT SUM(balance.outstanding_balance) FROM outstanding AS balance), 0::numeric) AS total_outstanding
  )
  SELECT
    restaurant.id,
    restaurant.name,
    report_date::text,
    reporting_timezone,
    requested_period_start,
    requested_period_end,
    to_char(summary.total_revenue, 'FM9999999990.00'),
    to_char(summary.total_outstanding, 'FM9999999990.00'),
    method_totals_json.value,
    outstanding_json.value,
    partial_json.value,
    payment_history_json.value
  FROM requested_restaurant AS restaurant
  CROSS JOIN summary
  CROSS JOIN method_totals_json
  CROSS JOIN outstanding_json
  CROSS JOIN partial_json
  CROSS JOIN payment_history_json;
END;
$$;

REVOKE ALL ON FUNCTION public.read_payment_report(uuid, uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_payment_report(uuid, uuid, date, text)
  TO service_role;
