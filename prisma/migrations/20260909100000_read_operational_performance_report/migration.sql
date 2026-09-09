ALTER TABLE public.order_line_sale_snapshots
  ADD COLUMN category_id uuid,
  ADD COLUMN category_name text,
  ADD CONSTRAINT order_line_sale_snapshots_category_snapshot_complete
    CHECK (
      (category_id IS NULL AND category_name IS NULL)
      OR (category_id IS NOT NULL AND btrim(category_name) <> '')
    );

CREATE INDEX order_line_snapshots_category_idx
  ON public.order_line_sale_snapshots(restaurant_id, category_id);

-- Historical snapshots are deliberately left NULL.  The insert-time trigger
-- captures the catalog category only for new snapshots, before a later
-- recategorization can change that historical business fact.
CREATE FUNCTION public.capture_order_line_sale_snapshot_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  category_record public.product_categories%ROWTYPE;
BEGIN
  SELECT category.* INTO category_record
  FROM public.product_versions AS version
  JOIN public.products AS product
    ON product.restaurant_id = version.restaurant_id
   AND product.id = version.product_id
  JOIN public.product_categories AS category
    ON category.restaurant_id = product.restaurant_id
   AND category.id = product.category_id
  WHERE version.restaurant_id = NEW.restaurant_id
    AND version.id = NEW.product_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale snapshot category configuration does not exist'
      USING ERRCODE = '23503';
  END IF;

  NEW.category_id := category_record.id;
  NEW.category_name := category_record.name;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_line_sale_snapshots_capture_category
BEFORE INSERT ON public.order_line_sale_snapshots
FOR EACH ROW EXECUTE FUNCTION public.capture_order_line_sale_snapshot_category();

CREATE INDEX orders_restaurant_ready_at_idx
  ON public.orders(restaurant_id, ready_at);
CREATE INDEX orders_restaurant_on_the_way_at_idx
  ON public.orders(restaurant_id, on_the_way_at);
CREATE INDEX orders_restaurant_delivered_at_idx
  ON public.orders(restaurant_id, delivered_at);

CREATE OR REPLACE FUNCTION public.read_operational_performance_report(
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
  product_sales jsonb,
  category_sales jsonb,
  average_preparation_minutes text,
  longest_preparation_minutes text,
  orders_currently_in_preparation bigint,
  peak_preparation_periods jsonb,
  average_ready_to_on_the_way_minutes text,
  average_on_the_way_to_delivered_minutes text,
  delivered_orders bigint,
  orders_waiting_for_delivery bigint
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
    RAISE EXCEPTION 'Operational performance report input is invalid' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.application_users AS application_user
    JOIN public.user_role_assignments AS assignment ON assignment.user_id = application_user.id
    JOIN public.role_permissions AS role_permission ON role_permission.role_id = assignment.role_id
    JOIN public.permissions AS permission ON permission.id = role_permission.permission_id
    WHERE application_user.id = actor_user_id
      AND application_user.is_active = true
      AND permission.code = 'reports.view'
  ) THEN
    RAISE EXCEPTION 'Operational performance report is unauthorized' USING ERRCODE = '42501';
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
  paid_current_lines AS (
    SELECT snapshot.*, version.product_id, sale_order.paid_at
    FROM public.orders AS sale_order
    JOIN public.customer_baskets AS basket
      ON basket.restaurant_id = sale_order.restaurant_id AND basket.order_id = sale_order.id
    JOIN public.order_lines AS line
      ON line.restaurant_id = basket.restaurant_id AND line.basket_id = basket.id
    JOIN public.order_line_sale_snapshots AS snapshot
      ON snapshot.restaurant_id = line.restaurant_id
     AND snapshot.order_line_id = line.id
     AND snapshot.id = line.current_snapshot_id
    JOIN public.product_versions AS version
      ON version.restaurant_id = snapshot.restaurant_id
     AND version.id = snapshot.product_version_id
    LEFT JOIN public.order_line_removals AS removal
      ON removal.restaurant_id = line.restaurant_id AND removal.order_line_id = line.id
    WHERE sale_order.restaurant_id = target_restaurant_id
      AND sale_order.paid_at >= requested_period_start
      AND sale_order.paid_at < requested_period_end
      AND removal.order_line_id IS NULL
  ),
  product_totals AS (
    SELECT snapshot.product_id,
      (array_agg(snapshot.product_name ORDER BY snapshot.paid_at DESC, snapshot.id DESC))[1] AS product_name,
      SUM(snapshot.quantity)::bigint AS quantity_sold,
      SUM(snapshot.line_total) AS revenue
    FROM paid_current_lines AS snapshot
    GROUP BY snapshot.product_id
  ),
  products_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product.product_id, 'product_name', product.product_name,
      'quantity_sold', product.quantity_sold,
      'revenue', to_char(product.revenue, 'FM9999999990.00')
    ) ORDER BY product.revenue DESC, product.quantity_sold DESC, product.product_name, product.product_id), '[]'::jsonb) AS value
    FROM product_totals AS product
  ),
  category_totals AS (
    SELECT snapshot.category_id,
      COALESCE(snapshot.category_name, 'Unattributed historical category') AS category_name,
      SUM(snapshot.quantity)::bigint AS quantity_sold, SUM(snapshot.line_total) AS revenue
    FROM paid_current_lines AS snapshot
    GROUP BY snapshot.category_id, snapshot.category_name
  ),
  categories_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'category_id', category.category_id, 'category_name', category.category_name,
      'quantity_sold', category.quantity_sold,
      'revenue', to_char(category.revenue, 'FM9999999990.00')
    ) ORDER BY category.revenue DESC, category.quantity_sold DESC, category.category_name), '[]'::jsonb) AS value
    FROM category_totals AS category
  ),
  completed_preparation AS (
    SELECT EXTRACT(EPOCH FROM (sale_order.ready_at - sale_order.created_at)) / 60 AS minutes
    FROM public.orders AS sale_order
    WHERE sale_order.restaurant_id = target_restaurant_id
      AND sale_order.ready_at >= requested_period_start
      AND sale_order.ready_at < requested_period_end
      AND sale_order.ready_at >= sale_order.created_at
  ),
  preparation_metrics AS (
    SELECT COALESCE(AVG(minutes), 0::numeric) AS average_minutes,
      COALESCE(MAX(minutes), 0::numeric) AS longest_minutes
    FROM completed_preparation
  ),
  preparation_peaks AS (
    SELECT EXTRACT(HOUR FROM sale_order.created_at AT TIME ZONE reporting_timezone)::integer AS local_hour,
      COUNT(*)::bigint AS orders
    FROM public.orders AS sale_order
    WHERE sale_order.restaurant_id = target_restaurant_id
      AND sale_order.created_at >= requested_period_start
      AND sale_order.created_at < requested_period_end
    GROUP BY EXTRACT(HOUR FROM sale_order.created_at AT TIME ZONE reporting_timezone)
  ),
  preparation_peaks_json AS (
    SELECT jsonb_agg(jsonb_build_object('hour', hour.value, 'orders', COALESCE(peak.orders, 0)) ORDER BY hour.value) AS value
    FROM generate_series(0, 23) AS hour(value)
    LEFT JOIN preparation_peaks AS peak ON peak.local_hour = hour.value
  ),
  delivery_metrics AS (
    SELECT
      COALESCE(AVG(EXTRACT(EPOCH FROM (sale_order.on_the_way_at - sale_order.ready_at)) / 60)
        FILTER (WHERE sale_order.on_the_way_at >= requested_period_start AND sale_order.on_the_way_at < requested_period_end
          AND sale_order.ready_at IS NOT NULL AND sale_order.on_the_way_at >= sale_order.ready_at), 0::numeric) AS ready_to_on_the_way_minutes,
      COALESCE(AVG(EXTRACT(EPOCH FROM (sale_order.delivered_at - sale_order.on_the_way_at)) / 60)
        FILTER (WHERE sale_order.delivered_at >= requested_period_start AND sale_order.delivered_at < requested_period_end
          AND sale_order.on_the_way_at IS NOT NULL AND sale_order.delivered_at >= sale_order.on_the_way_at), 0::numeric) AS on_the_way_to_delivered_minutes,
      COUNT(*) FILTER (WHERE sale_order.delivered_at >= requested_period_start AND sale_order.delivered_at < requested_period_end)::bigint AS delivered_orders,
      COUNT(*) FILTER (WHERE sale_order.status = 'READY')::bigint AS waiting_for_delivery
    FROM public.orders AS sale_order
    WHERE sale_order.restaurant_id = target_restaurant_id
  )
  SELECT restaurant.id, restaurant.name, report_date::text, reporting_timezone,
    requested_period_start, requested_period_end, products_json.value, categories_json.value,
    to_char(preparation_metrics.average_minutes, 'FM9999999990.00'),
    to_char(preparation_metrics.longest_minutes, 'FM9999999990.00'),
    (SELECT COUNT(*) FROM public.orders AS pending_order
      WHERE pending_order.restaurant_id = target_restaurant_id AND pending_order.status = 'PENDING'),
    preparation_peaks_json.value,
    to_char(delivery_metrics.ready_to_on_the_way_minutes, 'FM9999999990.00'),
    to_char(delivery_metrics.on_the_way_to_delivered_minutes, 'FM9999999990.00'),
    delivery_metrics.delivered_orders, delivery_metrics.waiting_for_delivery
  FROM requested_restaurant AS restaurant
  CROSS JOIN products_json CROSS JOIN categories_json CROSS JOIN preparation_metrics
  CROSS JOIN preparation_peaks_json CROSS JOIN delivery_metrics;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_order_line_sale_snapshot_category() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_operational_performance_report(uuid, uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_operational_performance_report(uuid, uuid, date, text)
  TO service_role;
