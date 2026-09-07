CREATE OR REPLACE FUNCTION public.assert_inventory_purchase_integrity(
  restaurant_id_to_check uuid,
  purchase_id_to_check uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  purchase_record public.inventory_purchases%ROWTYPE;
  line_count integer;
  line_total_sum numeric;
  movement_count integer;
  expense_count integer;
BEGIN
  SELECT purchase.*
  INTO purchase_record
  FROM public.inventory_purchases AS purchase
  WHERE purchase.restaurant_id = restaurant_id_to_check
    AND purchase.id = purchase_id_to_check;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory purchase origin does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT count(*), COALESCE(sum(line.line_total), 0)
  INTO line_count, line_total_sum
  FROM public.inventory_purchase_lines AS line
  WHERE line.restaurant_id = purchase_record.restaurant_id
    AND line.purchase_id = purchase_record.id;

  IF line_count < 1 OR line_count > 100 OR line_total_sum <> purchase_record.total_amount THEN
    RAISE EXCEPTION 'inventory purchase line totals are inconsistent'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO movement_count
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = purchase_record.restaurant_id
    AND movement.business_origin_type = 'PURCHASE'
    AND movement.business_origin_id = purchase_record.id;

  IF movement_count <> line_count THEN
    RAISE EXCEPTION 'inventory purchase movement origin is not exclusive'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_purchase_lines AS line
    LEFT JOIN public.inventory_movements AS movement
      ON movement.restaurant_id = line.restaurant_id
     AND movement.inventory_item_id = line.inventory_item_id
     AND movement.id = line.inventory_movement_id
    WHERE line.restaurant_id = purchase_record.restaurant_id
      AND line.purchase_id = purchase_record.id
      AND (
        movement.id IS NULL
        OR movement.type IS DISTINCT FROM 'PURCHASE'
        OR movement.quantity_delta IS DISTINCT FROM line.quantity
        OR movement.unit_of_measure IS DISTINCT FROM line.unit_of_measure
        OR movement.recorded_by_id IS DISTINCT FROM purchase_record.recorded_by_id
        OR movement.recorded_at IS DISTINCT FROM purchase_record.recorded_at
        OR movement.business_origin_type IS DISTINCT FROM 'PURCHASE'
        OR movement.business_origin_id IS DISTINCT FROM purchase_record.id
        OR movement.comments IS DISTINCT FROM purchase_record.comments
      )
  ) THEN
    RAISE EXCEPTION 'inventory purchase movement is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO expense_count
  FROM public.operating_expenses AS expense
  WHERE expense.restaurant_id = purchase_record.restaurant_id
    AND expense.origin_type = 'PURCHASE'
    AND expense.origin_id = purchase_record.id;

  IF expense_count <> 1 THEN
    RAISE EXCEPTION 'inventory purchase expense origin is not exclusive'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.operating_expenses AS expense
    JOIN public.expense_categories AS category
      ON category.restaurant_id = expense.restaurant_id
     AND category.id = expense.expense_category_id
    WHERE expense.restaurant_id = purchase_record.restaurant_id
      AND expense.id = purchase_record.operating_expense_id
      AND expense.expense_category_id = purchase_record.expense_category_id
      AND expense.amount = purchase_record.total_amount
      AND expense.incurred_at = purchase_record.recorded_at
      AND expense.recorded_at = purchase_record.recorded_at
      AND expense.recorded_by_id = purchase_record.recorded_by_id
      AND expense.reference_number IS NOT DISTINCT FROM purchase_record.reference_number
      AND expense.comments IS NOT DISTINCT FROM purchase_record.comments
      AND expense.expense_category_code = category.code
      AND expense.expense_category_name = category.name
      AND expense.origin_type = 'PURCHASE'
      AND expense.origin_id = purchase_record.id
  ) THEN
    RAISE EXCEPTION 'inventory purchase expense is inconsistent'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
