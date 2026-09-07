CREATE TABLE public.inventory_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  expense_category_id uuid NOT NULL,
  operating_expense_id uuid NOT NULL,
  recorded_by_id uuid NOT NULL,
  supplier_name text,
  reference_number text,
  comments text,
  total_amount numeric(12, 2) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_purchases_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_purchases_category_fkey
    FOREIGN KEY (restaurant_id, expense_category_id) REFERENCES public.expense_categories(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_purchases_recorded_by_fkey
    FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_purchases_expense_fkey
    FOREIGN KEY (restaurant_id, operating_expense_id) REFERENCES public.operating_expenses(restaurant_id, id)
      ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT inventory_purchases_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT inventory_purchases_restaurant_expense_key UNIQUE (restaurant_id, operating_expense_id),
  CONSTRAINT inventory_purchases_total_positive CHECK (total_amount > 0),
  CONSTRAINT inventory_purchases_supplier_not_blank CHECK (supplier_name IS NULL OR btrim(supplier_name) <> ''),
  CONSTRAINT inventory_purchases_reference_not_blank CHECK (reference_number IS NULL OR btrim(reference_number) <> ''),
  CONSTRAINT inventory_purchases_comments_not_blank CHECK (comments IS NULL OR btrim(comments) <> '')
);

CREATE INDEX inventory_purchases_restaurant_recorded_idx
  ON public.inventory_purchases(restaurant_id, recorded_at);
CREATE INDEX inventory_purchases_category_recorded_idx
  ON public.inventory_purchases(restaurant_id, expense_category_id, recorded_at);
CREATE INDEX inventory_purchases_recorder_recorded_idx
  ON public.inventory_purchases(recorded_by_id, recorded_at);

CREATE TABLE public.inventory_purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL,
  quantity numeric(14, 3) NOT NULL,
  unit_of_measure text NOT NULL,
  unit_price numeric(12, 2) NOT NULL,
  line_total numeric(12, 2) NOT NULL,
  CONSTRAINT inventory_purchase_lines_purchase_fkey
    FOREIGN KEY (restaurant_id, purchase_id) REFERENCES public.inventory_purchases(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_purchase_lines_item_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_purchase_lines_movement_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id, inventory_movement_id)
      REFERENCES public.inventory_movements(restaurant_id, inventory_item_id, id)
      ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT inventory_purchase_lines_purchase_item_key UNIQUE (restaurant_id, purchase_id, inventory_item_id),
  CONSTRAINT inventory_purchase_lines_item_movement_key UNIQUE (restaurant_id, inventory_item_id, inventory_movement_id),
  CONSTRAINT inventory_purchase_lines_movement_key UNIQUE (restaurant_id, inventory_movement_id),
  CONSTRAINT inventory_purchase_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT inventory_purchase_lines_unit_not_blank CHECK (btrim(unit_of_measure) <> ''),
  CONSTRAINT inventory_purchase_lines_price_positive CHECK (unit_price > 0),
  CONSTRAINT inventory_purchase_lines_total_positive CHECK (line_total > 0),
  CONSTRAINT inventory_purchase_lines_total_exact CHECK (line_total = round(quantity * unit_price, 2))
);

CREATE INDEX inventory_purchase_lines_item_idx
  ON public.inventory_purchase_lines(restaurant_id, inventory_item_id);

CREATE FUNCTION public.reject_inventory_purchase_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inventory_purchases_immutable
BEFORE UPDATE OR DELETE ON public.inventory_purchases
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_purchase_history_mutation();

CREATE TRIGGER inventory_purchase_lines_immutable
BEFORE UPDATE OR DELETE ON public.inventory_purchase_lines
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_purchase_history_mutation();

CREATE FUNCTION public.assert_inventory_purchase_integrity(
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

CREATE FUNCTION public.check_inventory_purchase_integrity_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'inventory_purchases' THEN
    PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'inventory_purchase_lines' THEN
    PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.purchase_id);
  ELSIF TG_TABLE_NAME = 'inventory_movements' AND NEW.business_origin_type = 'PURCHASE' THEN
    PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.business_origin_id);
  ELSIF TG_TABLE_NAME = 'operating_expenses' AND NEW.origin_type = 'PURCHASE' THEN
    PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.origin_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER inventory_purchases_integrity_deferred
AFTER INSERT ON public.inventory_purchases
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_purchase_integrity_deferred();

CREATE CONSTRAINT TRIGGER inventory_purchase_lines_integrity_deferred
AFTER INSERT ON public.inventory_purchase_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_purchase_integrity_deferred();

CREATE CONSTRAINT TRIGGER purchase_movements_integrity_deferred
AFTER INSERT ON public.inventory_movements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_purchase_integrity_deferred();

CREATE CONSTRAINT TRIGGER purchase_expenses_integrity_deferred
AFTER INSERT ON public.operating_expenses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_purchase_integrity_deferred();

ALTER TABLE public.inventory_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_purchase_lines ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.register_inventory_purchase(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_expense_category_id uuid,
  supplier_name text,
  purchase_reference_number text,
  purchase_comments text,
  purchase_lines_text text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  purchase_id uuid,
  restaurant_id uuid,
  expense_category_id uuid,
  operating_expense_id uuid,
  recorded_by_id uuid,
  supplier_name_result text,
  reference_number text,
  comments text,
  total_amount numeric,
  recorded_at timestamptz,
  lines jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  purchase_lines jsonb;
  source_line jsonb;
  source_ip_value inet;
  normalized_supplier text;
  normalized_reference text;
  normalized_comments text;
  category_record public.expense_categories%ROWTYPE;
  item_record record;
  inventory_item_id_value uuid;
  quantity_value numeric;
  unit_price_value numeric;
  line_total_value numeric;
  total_amount_value numeric;
  new_purchase_id uuid := gen_random_uuid();
  new_expense_id uuid := gen_random_uuid();
  new_movement_id uuid;
  result_lines jsonb := '[]'::jsonb;
BEGIN
  IF actor_user_id IS NULL
    OR target_restaurant_id IS NULL
    OR target_expense_category_id IS NULL
    OR purchase_lines_text IS NULL
    OR length(purchase_lines_text) > 1048576
    OR audit_occurred_at IS NULL
    OR (supplier_name IS NOT NULL AND length(btrim(supplier_name)) > 200)
    OR (purchase_reference_number IS NOT NULL AND length(btrim(purchase_reference_number)) > 200)
    OR (purchase_comments IS NOT NULL AND length(btrim(purchase_comments)) > 2000)
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'Inventory purchase input is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Inventory purchase timestamp is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := NULLIF(btrim(audit_source_ip), '')::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Inventory purchase audit source IP is invalid'
        USING ERRCODE = '22023';
    END;
  END IF;

  normalized_supplier := NULLIF(regexp_replace(btrim(supplier_name), '\s+', ' ', 'g'), '');
  normalized_reference := NULLIF(regexp_replace(btrim(purchase_reference_number), '\s+', ' ', 'g'), '');
  normalized_comments := NULLIF(regexp_replace(btrim(purchase_comments), '\s+', ' ', 'g'), '');

  BEGIN
    purchase_lines := purchase_lines_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Inventory purchase lines are invalid' USING ERRCODE = '22023';
  END;

  IF jsonb_typeof(purchase_lines) IS DISTINCT FROM 'array'
    OR jsonb_array_length(purchase_lines) < 1
    OR jsonb_array_length(purchase_lines) > 100 THEN
    RAISE EXCEPTION 'Inventory purchase lines are invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.application_users AS application_user
  JOIN public.user_role_assignments AS assignment
    ON assignment.user_id = application_user.id
  JOIN public.role_permissions AS role_permission
    ON role_permission.role_id = assignment.role_id
  JOIN public.permissions AS permission
    ON permission.id = role_permission.permission_id
  WHERE application_user.id = actor_user_id
    AND application_user.is_active
    AND permission.code = 'inventory.purchases.register'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory purchase registration is unauthorized'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.restaurants AS restaurant
  WHERE restaurant.id = target_restaurant_id
    AND restaurant.is_active
    AND restaurant.deleted_at IS NULL
  FOR KEY SHARE OF restaurant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_PURCHASE_RESTAURANT_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT category.*
  INTO category_record
  FROM public.expense_categories AS category
  WHERE category.restaurant_id = target_restaurant_id
    AND category.id = target_expense_category_id
    AND category.is_active
    AND category.deleted_at IS NULL
  FOR KEY SHARE OF category;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_PURCHASE_CATEGORY_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMP TABLE pg_temp.inventory_purchase_input_lines (
    inventory_item_id uuid PRIMARY KEY,
    quantity numeric(14, 3) NOT NULL,
    unit_price numeric(12, 2) NOT NULL,
    unit_of_measure text,
    line_total numeric
  ) ON COMMIT DROP;

  FOR source_line IN SELECT value FROM jsonb_array_elements(purchase_lines)
  LOOP
    IF jsonb_typeof(source_line) IS DISTINCT FROM 'object'
      OR NOT (source_line ? 'inventoryItemId' AND source_line ? 'quantity' AND source_line ? 'unitPrice')
      OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(source_line) AS key(name)
        WHERE name NOT IN ('inventoryItemId', 'quantity', 'unitPrice')
      )
      OR jsonb_typeof(source_line -> 'inventoryItemId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(source_line -> 'quantity') IS DISTINCT FROM 'string'
      OR jsonb_typeof(source_line -> 'unitPrice') IS DISTINCT FROM 'string'
      OR (source_line ->> 'inventoryItemId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR (source_line ->> 'quantity') !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$'
      OR (source_line ->> 'unitPrice') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Inventory purchase line is invalid' USING ERRCODE = '22023';
    END IF;

    BEGIN
      inventory_item_id_value := (source_line ->> 'inventoryItemId')::uuid;
      quantity_value := (source_line ->> 'quantity')::numeric;
      unit_price_value := (source_line ->> 'unitPrice')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Inventory purchase line is invalid' USING ERRCODE = '22023';
    END;

    IF quantity_value <= 0 OR unit_price_value <= 0 THEN
      RAISE EXCEPTION 'Inventory purchase line is invalid' USING ERRCODE = '22023';
    END IF;

    BEGIN
      INSERT INTO pg_temp.inventory_purchase_input_lines (
        inventory_item_id, quantity, unit_price
      ) VALUES (
        inventory_item_id_value, quantity_value, unit_price_value
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Inventory purchase item is duplicated' USING ERRCODE = '22023';
    END;
  END LOOP;

  FOR item_record IN
    SELECT item.id, item.unit_of_measure
    FROM public.inventory_items AS item
    JOIN pg_temp.inventory_purchase_input_lines AS input_line
      ON input_line.inventory_item_id = item.id
    WHERE item.restaurant_id = target_restaurant_id
      AND item.is_active
      AND item.deleted_at IS NULL
    ORDER BY item.id
    FOR KEY SHARE OF item
  LOOP
    UPDATE pg_temp.inventory_purchase_input_lines AS input_line
    SET unit_of_measure = item_record.unit_of_measure,
        line_total = round(input_line.quantity * input_line.unit_price, 2)
    WHERE input_line.inventory_item_id = item_record.id;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.inventory_purchase_input_lines
    WHERE unit_of_measure IS NULL
  ) THEN
    RAISE EXCEPTION 'INVENTORY_PURCHASE_ITEM_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.inventory_purchase_input_lines
    WHERE line_total IS NULL OR line_total <= 0 OR line_total > 9999999999.99
  ) THEN
    RAISE EXCEPTION 'Inventory purchase line total is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT sum(input_line.line_total)
  INTO total_amount_value
  FROM pg_temp.inventory_purchase_input_lines AS input_line;

  IF total_amount_value IS NULL OR total_amount_value <= 0 OR total_amount_value > 9999999999.99 THEN
    RAISE EXCEPTION 'Inventory purchase total is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventory_purchases (
    id, restaurant_id, expense_category_id, operating_expense_id,
    recorded_by_id, supplier_name, reference_number, comments,
    total_amount, recorded_at
  ) VALUES (
    new_purchase_id, target_restaurant_id, category_record.id, new_expense_id,
    actor_user_id, normalized_supplier, normalized_reference, normalized_comments,
    total_amount_value, audit_occurred_at
  );

  FOR item_record IN
    SELECT * FROM pg_temp.inventory_purchase_input_lines ORDER BY inventory_item_id
  LOOP
    new_movement_id := gen_random_uuid();

    INSERT INTO public.inventory_movements (
      id, restaurant_id, inventory_item_id, type, quantity_delta,
      unit_of_measure, recorded_by_id, recorded_at,
      business_origin_type, business_origin_id, comments, reversed_movement_id
    ) VALUES (
      new_movement_id, target_restaurant_id, item_record.inventory_item_id,
      'PURCHASE', item_record.quantity, item_record.unit_of_measure,
      actor_user_id, audit_occurred_at, 'PURCHASE', new_purchase_id,
      normalized_comments, NULL
    );

    INSERT INTO public.inventory_purchase_lines (
      restaurant_id, purchase_id, inventory_item_id, inventory_movement_id,
      quantity, unit_of_measure, unit_price, line_total
    ) VALUES (
      target_restaurant_id, new_purchase_id, item_record.inventory_item_id,
      new_movement_id, item_record.quantity, item_record.unit_of_measure,
      item_record.unit_price, item_record.line_total
    );

    result_lines := result_lines || jsonb_build_array(jsonb_build_object(
      'inventoryItemId', item_record.inventory_item_id,
      'inventoryMovementId', new_movement_id,
      'quantity', item_record.quantity,
      'unitOfMeasure', item_record.unit_of_measure,
      'unitPrice', item_record.unit_price,
      'lineTotal', item_record.line_total
    ));
  END LOOP;

  INSERT INTO public.operating_expenses (
    id, restaurant_id, expense_category_id, amount, description,
    incurred_at, recorded_at, recorded_by_id, reference_number, comments,
    expense_category_code, expense_category_name, origin_type, origin_id
  ) VALUES (
    new_expense_id, target_restaurant_id, category_record.id,
    total_amount_value, 'Inventory purchase', audit_occurred_at,
    audit_occurred_at, actor_user_id, normalized_reference, normalized_comments,
    category_record.code, category_record.name, 'PURCHASE', new_purchase_id
  );

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id, audit_occurred_at, 'inventory_purchase.registered',
    'inventory_purchase', new_purchase_id::text, NULL,
    jsonb_build_object(
      'purchaseId', new_purchase_id,
      'restaurantId', target_restaurant_id,
      'expenseCategoryId', category_record.id,
      'expenseCategoryCode', category_record.code,
      'expenseCategoryName', category_record.name,
      'operatingExpenseId', new_expense_id,
      'recordedById', actor_user_id,
      'supplierName', normalized_supplier,
      'referenceNumber', normalized_reference,
      'comments', normalized_comments,
      'totalAmount', total_amount_value,
      'recordedAt', audit_occurred_at,
      'lines', result_lines
    ),
    source_ip_value
  );

  RETURN QUERY SELECT
    new_purchase_id,
    target_restaurant_id,
    category_record.id,
    new_expense_id,
    actor_user_id,
    normalized_supplier,
    normalized_reference,
    normalized_comments,
    total_amount_value,
    audit_occurred_at,
    result_lines;
END;
$$;

REVOKE ALL ON FUNCTION public.register_inventory_purchase(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_inventory_purchase(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) TO service_role;
