CREATE INDEX orders_restaurant_created_at_idx
  ON public.orders(restaurant_id, created_at);

CREATE INDEX orders_restaurant_paid_at_idx
  ON public.orders(restaurant_id, paid_at);

CREATE INDEX payments_restaurant_recorded_at_idx
  ON public.payments(restaurant_id, recorded_at);

CREATE OR REPLACE FUNCTION public.read_daily_sales_report(
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
  orders_created bigint,
  orders_completed bigint,
  average_ticket text,
  hourly_revenue jsonb
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
    RAISE EXCEPTION 'Daily sales report input is invalid' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Daily sales report is unauthorized' USING ERRCODE = '42501';
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
  payment_totals AS (
    SELECT
      COALESCE(SUM(payment.amount), 0::numeric) AS total_revenue
    FROM public.payments AS payment
    WHERE payment.restaurant_id = target_restaurant_id
      AND payment.recorded_at >= requested_period_start
      AND payment.recorded_at < requested_period_end
  ),
  created_orders AS (
    SELECT COUNT(*) AS orders_created
    FROM public.orders AS sale_order
    WHERE sale_order.restaurant_id = target_restaurant_id
      AND sale_order.created_at >= requested_period_start
      AND sale_order.created_at < requested_period_end
  ),
  completed_orders AS (
    SELECT
      COUNT(*) AS orders_completed,
      COALESCE(AVG(sale_order.total_amount), 0::numeric) AS average_ticket
    FROM public.orders AS sale_order
    WHERE sale_order.restaurant_id = target_restaurant_id
      AND sale_order.paid_at >= requested_period_start
      AND sale_order.paid_at < requested_period_end
  ),
  hourly_payment_totals AS (
    SELECT
      EXTRACT(HOUR FROM payment.recorded_at AT TIME ZONE reporting_timezone)::integer AS local_hour,
      SUM(payment.amount) AS amount
    FROM public.payments AS payment
    WHERE payment.restaurant_id = target_restaurant_id
      AND payment.recorded_at >= requested_period_start
      AND payment.recorded_at < requested_period_end
    GROUP BY EXTRACT(HOUR FROM payment.recorded_at AT TIME ZONE reporting_timezone)
  ),
  hourly_buckets AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'hour', hour.value,
        'amount', to_char(COALESCE(hourly.amount, 0::numeric), 'FM9999999990.00')
      )
      ORDER BY hour.value
    ) AS hourly_revenue
    FROM generate_series(0, 23) AS hour(value)
    LEFT JOIN hourly_payment_totals AS hourly
      ON hourly.local_hour = hour.value
  )
  SELECT
    restaurant.id,
    restaurant.name,
    report_date::text,
    reporting_timezone,
    requested_period_start,
    requested_period_end,
    to_char(payment_totals.total_revenue, 'FM9999999990.00'),
    created_orders.orders_created,
    completed_orders.orders_completed,
    to_char(completed_orders.average_ticket, 'FM9999999990.00'),
    hourly_buckets.hourly_revenue
  FROM requested_restaurant AS restaurant
  CROSS JOIN payment_totals
  CROSS JOIN created_orders
  CROSS JOIN completed_orders
  CROSS JOIN hourly_buckets;
END;
$$;

REVOKE ALL ON FUNCTION public.read_daily_sales_report(uuid, uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_daily_sales_report(uuid, uuid, date, text)
  TO service_role;
