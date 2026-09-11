CREATE INDEX inventory_movements_restaurant_recorded_report_idx
  ON public.inventory_movements(restaurant_id, recorded_at);
CREATE INDEX production_batches_restaurant_completed_report_idx
  ON public.production_batches(restaurant_id, status, completed_at);
CREATE INDEX inventory_adjustments_restaurant_recorded_report_idx
  ON public.inventory_adjustments(restaurant_id, recorded_at);
CREATE INDEX inventory_waste_records_restaurant_recorded_report_idx
  ON public.inventory_waste_records(restaurant_id, recorded_at);
CREATE INDEX operating_expenses_restaurant_incurred_report_idx
  ON public.operating_expenses(restaurant_id, incurred_at);

CREATE OR REPLACE FUNCTION public.read_inventory_production_expense_report(
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
  month_start timestamptz,
  month_end timestamptz,
  inventory_balances jsonb,
  active_alerts jsonb,
  movements jsonb,
  purchases jsonb,
  production_batches jsonb,
  adjustments jsonb,
  waste_records jsonb,
  expenses jsonb,
  daily_expense_total text,
  monthly_expense_total text,
  daily_expenses_by_category jsonb,
  monthly_expenses_by_category jsonb,
  monthly_expenses_by_day jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requested_period_start timestamptz;
  requested_period_end timestamptz;
  requested_month_start timestamptz;
  requested_month_end timestamptz;
BEGIN
  IF actor_user_id IS NULL
    OR target_restaurant_id IS NULL
    OR report_date IS NULL
    OR reporting_timezone IS DISTINCT FROM 'America/Guayaquil' THEN
    RAISE EXCEPTION 'Inventory, production, and expense report input is invalid'
      USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Inventory, production, and expense report is unauthorized'
      USING ERRCODE = '42501';
  END IF;

  requested_period_start := report_date::timestamp AT TIME ZONE reporting_timezone;
  requested_period_end := (report_date + 1)::timestamp AT TIME ZONE reporting_timezone;
  requested_month_start := date_trunc('month', report_date::timestamp)
    AT TIME ZONE reporting_timezone;
  requested_month_end := (date_trunc('month', report_date::timestamp) + interval '1 month')
    AT TIME ZONE reporting_timezone;

  RETURN QUERY
  WITH requested_restaurant AS (
    SELECT restaurant.id, restaurant.name
    FROM public.restaurants AS restaurant
    WHERE restaurant.id = target_restaurant_id
      AND restaurant.is_active = true
      AND restaurant.deleted_at IS NULL
  ),
  inventory_state AS (
    SELECT item.id, item.name, item.type::text AS item_type,
      item.unit_of_measure, item.minimum_stock_level,
      COALESCE(SUM(movement.quantity_delta), 0::numeric) AS current_balance
    FROM public.inventory_items AS item
    LEFT JOIN public.inventory_movements AS movement
      ON movement.restaurant_id = item.restaurant_id
     AND movement.inventory_item_id = item.id
    WHERE item.restaurant_id = target_restaurant_id
    GROUP BY item.id, item.name, item.type, item.unit_of_measure,
      item.minimum_stock_level
  ),
  inventory_balances_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'inventory_item_id', item.id,
      'inventory_item_name', item.name,
      'inventory_item_type', item.item_type,
      'unit_of_measure', item.unit_of_measure,
      'minimum_stock_level', to_char(item.minimum_stock_level, 'FM99999999990.000'),
      'current_balance', to_char(item.current_balance, 'FM99999999990.000'),
      'is_below_minimum', item.current_balance < item.minimum_stock_level
    ) ORDER BY item.name, item.id), '[]'::jsonb) AS value
    FROM inventory_state AS item
  ),
  active_alerts_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', alert.id,
      'inventory_item_id', alert.inventory_item_id,
      'inventory_item_name', item.name,
      'unit_of_measure', item.unit_of_measure,
      'threshold', to_char(alert.threshold, 'FM99999999990.000'),
      'observed_balance', to_char(alert.observed_balance, 'FM99999999990.000'),
      'opened_at', alert.opened_at
    ) ORDER BY alert.opened_at, alert.id), '[]'::jsonb) AS value
    FROM public.inventory_alerts AS alert
    JOIN public.inventory_items AS item
      ON item.restaurant_id = alert.restaurant_id
     AND item.id = alert.inventory_item_id
    WHERE alert.restaurant_id = target_restaurant_id
      AND alert.status = 'ACTIVE'
      AND alert.resolved_at IS NULL
  ),
  day_movements AS (
    SELECT movement.*, item.name AS inventory_item_name
    FROM public.inventory_movements AS movement
    JOIN public.inventory_items AS item
      ON item.restaurant_id = movement.restaurant_id
     AND item.id = movement.inventory_item_id
    WHERE movement.restaurant_id = target_restaurant_id
      AND movement.recorded_at >= requested_period_start
      AND movement.recorded_at < requested_period_end
  ),
  movements_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', movement.id,
      'inventory_item_id', movement.inventory_item_id,
      'inventory_item_name', movement.inventory_item_name,
      'type', movement.type::text,
      'quantity_delta', to_char(movement.quantity_delta, 'FM99999999990.000'),
      'unit_of_measure', movement.unit_of_measure,
      'recorded_by_id', movement.recorded_by_id,
      'recorded_at', movement.recorded_at,
      'business_origin_type', movement.business_origin_type::text,
      'business_origin_id', movement.business_origin_id,
      'comments', movement.comments,
      'reversed_movement_id', movement.reversed_movement_id
    ) ORDER BY movement.recorded_at DESC, movement.id DESC), '[]'::jsonb) AS value
    FROM day_movements AS movement
  ),
  day_purchases AS (
    SELECT purchase.*, expense.expense_category_code,
      expense.expense_category_name
    FROM public.inventory_purchases AS purchase
    JOIN public.operating_expenses AS expense
      ON expense.restaurant_id = purchase.restaurant_id
     AND expense.id = purchase.operating_expense_id
    WHERE purchase.restaurant_id = target_restaurant_id
      AND purchase.recorded_at >= requested_period_start
      AND purchase.recorded_at < requested_period_end
  ),
  purchases_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', purchase.id,
      'operating_expense_id', purchase.operating_expense_id,
      'expense_category_code', purchase.expense_category_code,
      'expense_category_name', purchase.expense_category_name,
      'recorded_by_id', purchase.recorded_by_id,
      'supplier_name', purchase.supplier_name,
      'reference_number', purchase.reference_number,
      'comments', purchase.comments,
      'total_amount', to_char(purchase.total_amount, 'FM9999999990.00'),
      'recorded_at', purchase.recorded_at,
      'lines', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'inventory_item_id', line.inventory_item_id,
          'inventory_item_name', item.name,
          'inventory_movement_id', line.inventory_movement_id,
          'quantity', to_char(line.quantity, 'FM99999999990.000'),
          'unit_of_measure', line.unit_of_measure,
          'unit_price', to_char(line.unit_price, 'FM9999999990.00'),
          'line_total', to_char(line.line_total, 'FM9999999990.00')
        ) ORDER BY item.name, line.id), '[]'::jsonb)
        FROM public.inventory_purchase_lines AS line
        JOIN public.inventory_items AS item
          ON item.restaurant_id = line.restaurant_id
         AND item.id = line.inventory_item_id
        WHERE line.restaurant_id = purchase.restaurant_id
          AND line.purchase_id = purchase.id
      )
    ) ORDER BY purchase.recorded_at DESC, purchase.id DESC), '[]'::jsonb) AS value
    FROM day_purchases AS purchase
  ),
  day_production_batches AS (
    SELECT batch.*, version.version_number, recipe.name AS recipe_name,
      recipe.output_inventory_item_id, item.name AS output_inventory_item_name
    FROM public.production_batches AS batch
    JOIN public.recipe_versions AS version
      ON version.restaurant_id = batch.restaurant_id
     AND version.id = batch.recipe_version_id
    JOIN public.recipes AS recipe
      ON recipe.restaurant_id = version.restaurant_id
     AND recipe.id = version.recipe_id
    JOIN public.inventory_items AS item
      ON item.restaurant_id = recipe.restaurant_id
     AND item.id = recipe.output_inventory_item_id
    WHERE batch.restaurant_id = target_restaurant_id
      AND batch.status = 'COMPLETED'
      AND batch.completed_at >= requested_period_start
      AND batch.completed_at < requested_period_end
  ),
  production_batches_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', batch.id,
      'recipe_version_id', batch.recipe_version_id,
      'recipe_version_number', batch.version_number,
      'recipe_name', batch.recipe_name,
      'output_inventory_item_id', batch.output_inventory_item_id,
      'output_inventory_item_name', batch.output_inventory_item_name,
      'produced_quantity', to_char(batch.produced_quantity, 'FM99999999990.000'),
      'unit_of_measure', batch.unit_of_measure,
      'completed_by_id', batch.completed_by_id,
      'completed_at', batch.completed_at,
      'notes', batch.notes
    ) ORDER BY batch.completed_at DESC, batch.id DESC), '[]'::jsonb) AS value
    FROM day_production_batches AS batch
  ),
  adjustments_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', adjustment.id,
      'inventory_item_id', adjustment.inventory_item_id,
      'inventory_item_name', item.name,
      'inventory_movement_id', adjustment.inventory_movement_id,
      'quantity', to_char(adjustment.quantity_delta, 'FM99999999990.000'),
      'unit_of_measure', adjustment.unit_of_measure,
      'reason', adjustment.reason,
      'recorded_by_id', adjustment.recorded_by_id,
      'recorded_at', adjustment.recorded_at
    ) ORDER BY adjustment.recorded_at DESC, adjustment.id DESC), '[]'::jsonb) AS value
    FROM public.inventory_adjustments AS adjustment
    JOIN public.inventory_items AS item
      ON item.restaurant_id = adjustment.restaurant_id
     AND item.id = adjustment.inventory_item_id
    WHERE adjustment.restaurant_id = target_restaurant_id
      AND adjustment.recorded_at >= requested_period_start
      AND adjustment.recorded_at < requested_period_end
  ),
  waste_records_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', waste.id,
      'inventory_item_id', waste.inventory_item_id,
      'inventory_item_name', item.name,
      'inventory_movement_id', waste.inventory_movement_id,
      'quantity', to_char(waste.quantity, 'FM99999999990.000'),
      'unit_of_measure', waste.unit_of_measure,
      'reason', waste.reason,
      'recorded_by_id', waste.recorded_by_id,
      'recorded_at', waste.recorded_at
    ) ORDER BY waste.recorded_at DESC, waste.id DESC), '[]'::jsonb) AS value
    FROM public.inventory_waste_records AS waste
    JOIN public.inventory_items AS item
      ON item.restaurant_id = waste.restaurant_id
     AND item.id = waste.inventory_item_id
    WHERE waste.restaurant_id = target_restaurant_id
      AND waste.recorded_at >= requested_period_start
      AND waste.recorded_at < requested_period_end
  ),
  day_expenses AS (
    SELECT expense.*
    FROM public.operating_expenses AS expense
    WHERE expense.restaurant_id = target_restaurant_id
      AND expense.incurred_at >= requested_period_start
      AND expense.incurred_at < requested_period_end
  ),
  month_expenses AS (
    SELECT expense.*
    FROM public.operating_expenses AS expense
    WHERE expense.restaurant_id = target_restaurant_id
      AND expense.incurred_at >= requested_month_start
      AND expense.incurred_at < requested_month_end
  ),
  expenses_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', expense.id,
      'amount', to_char(expense.amount, 'FM9999999990.00'),
      'description', expense.description,
      'incurred_at', expense.incurred_at,
      'recorded_at', expense.recorded_at,
      'recorded_by_id', expense.recorded_by_id,
      'reference_number', expense.reference_number,
      'comments', expense.comments,
      'expense_category_code', expense.expense_category_code,
      'expense_category_name', expense.expense_category_name,
      'origin_type', expense.origin_type::text,
      'origin_id', expense.origin_id
    ) ORDER BY expense.incurred_at DESC, expense.id DESC), '[]'::jsonb) AS value
    FROM day_expenses AS expense
  ),
  daily_expense_categories AS (
    SELECT expense.expense_category_code, expense.expense_category_name,
      SUM(expense.amount) AS amount
    FROM day_expenses AS expense
    GROUP BY expense.expense_category_code, expense.expense_category_name
  ),
  daily_expense_categories_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'expense_category_code', category.expense_category_code,
      'expense_category_name', category.expense_category_name,
      'amount', to_char(category.amount, 'FM9999999990.00')
    ) ORDER BY category.amount DESC, category.expense_category_name,
      category.expense_category_code), '[]'::jsonb) AS value
    FROM daily_expense_categories AS category
  ),
  monthly_expense_categories AS (
    SELECT expense.expense_category_code, expense.expense_category_name,
      SUM(expense.amount) AS amount
    FROM month_expenses AS expense
    GROUP BY expense.expense_category_code, expense.expense_category_name
  ),
  monthly_expense_categories_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'expense_category_code', category.expense_category_code,
      'expense_category_name', category.expense_category_name,
      'amount', to_char(category.amount, 'FM9999999990.00')
    ) ORDER BY category.amount DESC, category.expense_category_name,
      category.expense_category_code), '[]'::jsonb) AS value
    FROM monthly_expense_categories AS category
  ),
  monthly_expense_days AS (
    SELECT (expense.incurred_at AT TIME ZONE reporting_timezone)::date AS local_date,
      SUM(expense.amount) AS amount
    FROM month_expenses AS expense
    GROUP BY (expense.incurred_at AT TIME ZONE reporting_timezone)::date
  ),
  monthly_expense_days_json AS (
    SELECT jsonb_agg(jsonb_build_object(
      'date', day.value::text,
      'amount', to_char(COALESCE(expense.amount, 0::numeric), 'FM9999999990.00')
    ) ORDER BY day.value) AS value
    FROM generate_series(
      (requested_month_start AT TIME ZONE reporting_timezone)::date,
      ((requested_month_end AT TIME ZONE reporting_timezone)::date - 1),
      interval '1 day'
    ) AS day(value)
    LEFT JOIN monthly_expense_days AS expense ON expense.local_date = day.value::date
  ),
  expense_summary AS (
    SELECT
      COALESCE((SELECT SUM(expense.amount) FROM day_expenses AS expense), 0::numeric)
        AS daily_total,
      COALESCE((SELECT SUM(expense.amount) FROM month_expenses AS expense), 0::numeric)
        AS monthly_total
  )
  SELECT restaurant.id, restaurant.name, report_date::text, reporting_timezone,
    requested_period_start, requested_period_end,
    requested_month_start, requested_month_end,
    inventory_balances_json.value, active_alerts_json.value,
    movements_json.value, purchases_json.value, production_batches_json.value,
    adjustments_json.value, waste_records_json.value, expenses_json.value,
    to_char(expense_summary.daily_total, 'FM9999999990.00'),
    to_char(expense_summary.monthly_total, 'FM9999999990.00'),
    daily_expense_categories_json.value, monthly_expense_categories_json.value,
    monthly_expense_days_json.value
  FROM requested_restaurant AS restaurant
  CROSS JOIN inventory_balances_json
  CROSS JOIN active_alerts_json
  CROSS JOIN movements_json
  CROSS JOIN purchases_json
  CROSS JOIN production_batches_json
  CROSS JOIN adjustments_json
  CROSS JOIN waste_records_json
  CROSS JOIN expenses_json
  CROSS JOIN expense_summary
  CROSS JOIN daily_expense_categories_json
  CROSS JOIN monthly_expense_categories_json
  CROSS JOIN monthly_expense_days_json;
END;
$$;

REVOKE ALL ON FUNCTION public.read_inventory_production_expense_report(uuid, uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_inventory_production_expense_report(uuid, uuid, date, text)
  TO service_role;
