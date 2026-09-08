CREATE TABLE public.inventory_alert_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  inventory_alert_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL UNIQUE,
  status public.inventory_alert_status NOT NULL,
  threshold numeric(14, 3) NOT NULL,
  observed_balance numeric(14, 3) NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT inventory_alert_transitions_item_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id)
    REFERENCES public.inventory_items(restaurant_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_alert_transitions_alert_fkey
    FOREIGN KEY (restaurant_id, inventory_alert_id)
    REFERENCES public.inventory_alerts(restaurant_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_alert_transitions_movement_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id, inventory_movement_id)
    REFERENCES public.inventory_movements(restaurant_id, inventory_item_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_alert_transitions_alert_status_key
    UNIQUE (inventory_alert_id, status),
  CONSTRAINT inventory_alert_transitions_movement_key
    UNIQUE (restaurant_id, inventory_item_id, inventory_movement_id),
  CONSTRAINT inventory_alert_transitions_threshold_nonnegative
    CHECK (threshold >= 0)
);

CREATE INDEX inventory_alert_transitions_item_occurred_at_idx
  ON public.inventory_alert_transitions(
    restaurant_id, inventory_item_id, occurred_at
  );

CREATE FUNCTION public.reject_inventory_alert_transition_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'inventory alert transition history is immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inventory_alert_transitions_immutable
BEFORE UPDATE OR DELETE ON public.inventory_alert_transitions
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_alert_transition_mutation();

CREATE FUNCTION public.reconcile_inventory_alert_after_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  minimum_level numeric(14, 3);
  current_balance numeric(14, 3);
  active_alert public.inventory_alerts%ROWTYPE;
  alert_id_value uuid;
BEGIN
  SELECT item.minimum_stock_level
  INTO minimum_level
  FROM public.inventory_items AS item
  WHERE item.restaurant_id = NEW.restaurant_id
    AND item.id = NEW.inventory_item_id
  FOR UPDATE OF item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory alert item does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(sum(movement.quantity_delta), 0)::numeric(14, 3)
  INTO current_balance
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = NEW.restaurant_id
    AND movement.inventory_item_id = NEW.inventory_item_id;

  SELECT alert.*
  INTO active_alert
  FROM public.inventory_alerts AS alert
  WHERE alert.restaurant_id = NEW.restaurant_id
    AND alert.inventory_item_id = NEW.inventory_item_id
    AND alert.status = 'ACTIVE'
  FOR UPDATE OF alert;

  IF current_balance < minimum_level AND NOT FOUND THEN
    alert_id_value := gen_random_uuid();

    INSERT INTO public.inventory_alerts (
      id, restaurant_id, inventory_item_id, status, threshold,
      observed_balance, opened_at, resolved_at
    ) VALUES (
      alert_id_value, NEW.restaurant_id, NEW.inventory_item_id, 'ACTIVE',
      minimum_level, current_balance, NEW.recorded_at, NULL
    );

    INSERT INTO public.inventory_alert_transitions (
      restaurant_id, inventory_item_id, inventory_alert_id,
      inventory_movement_id, status, threshold, observed_balance, occurred_at
    ) VALUES (
      NEW.restaurant_id, NEW.inventory_item_id, alert_id_value, NEW.id,
      'ACTIVE', minimum_level, current_balance, NEW.recorded_at
    );
  ELSIF current_balance >= minimum_level AND FOUND THEN
    UPDATE public.inventory_alerts AS alert
    SET status = 'RESOLVED',
        resolved_at = GREATEST(NEW.recorded_at, active_alert.opened_at)
    WHERE alert.restaurant_id = active_alert.restaurant_id
      AND alert.id = active_alert.id;

    INSERT INTO public.inventory_alert_transitions (
      restaurant_id, inventory_item_id, inventory_alert_id,
      inventory_movement_id, status, threshold, observed_balance, occurred_at
    ) VALUES (
      NEW.restaurant_id, NEW.inventory_item_id, active_alert.id, NEW.id,
      'RESOLVED', minimum_level, current_balance,
      GREATEST(NEW.recorded_at, active_alert.opened_at)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_movements_reconcile_low_stock_alert
AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.reconcile_inventory_alert_after_movement();

ALTER TABLE public.inventory_alert_transitions ENABLE ROW LEVEL SECURITY;

ALTER FUNCTION public.confirm_order(
  uuid, uuid, text, text, timestamptz, text
) RENAME TO confirm_order_without_inventory_alerts;
REVOKE ALL ON FUNCTION public.confirm_order_without_inventory_alerts(
  uuid, uuid, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.confirm_order(
  actor_user_id uuid,
  target_service_location_id uuid,
  order_notes text,
  draft_baskets_text text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  order_id uuid,
  restaurant_id uuid,
  service_location_id uuid,
  order_number text,
  assigned_waiter_id uuid,
  status public.order_status,
  notes text,
  total_amount numeric(12, 2),
  confirmed_at timestamptz,
  baskets jsonb,
  inventory_alert_transitions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_record record;
  alert_summaries jsonb;
BEGIN
  SELECT result.* INTO STRICT result_record
  FROM public.confirm_order_without_inventory_alerts(
    actor_user_id, target_service_location_id, order_notes, draft_baskets_text,
    audit_occurred_at, audit_source_ip
  ) AS result;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inventory_alert_id', transition.inventory_alert_id,
    'inventory_movement_id', transition.inventory_movement_id,
    'inventory_item_id', transition.inventory_item_id,
    'status', transition.status,
    'threshold', transition.threshold,
    'observed_balance', transition.observed_balance,
    'occurred_at', transition.occurred_at
  ) ORDER BY transition.id), '[]'::jsonb)
  INTO alert_summaries
  FROM public.inventory_alert_transitions AS transition
  JOIN public.inventory_movements AS movement
    ON movement.restaurant_id = transition.restaurant_id
   AND movement.inventory_item_id = transition.inventory_item_id
   AND movement.id = transition.inventory_movement_id
  WHERE movement.restaurant_id = result_record.restaurant_id
    AND movement.business_origin_type = 'SALE'
    AND movement.business_origin_id = result_record.order_id;

  RETURN QUERY SELECT
    result_record.order_id, result_record.restaurant_id,
    result_record.service_location_id, result_record.order_number,
    result_record.assigned_waiter_id, result_record.status,
    result_record.notes, result_record.total_amount, result_record.confirmed_at,
    result_record.baskets, alert_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order(
  uuid, uuid, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order(
  uuid, uuid, text, text, timestamptz, text
) TO service_role;

ALTER FUNCTION public.modify_pending_order(
  uuid, uuid, timestamptz, text, timestamptz, text
) RENAME TO modify_pending_order_without_inventory_alerts;
REVOKE ALL ON FUNCTION public.modify_pending_order_without_inventory_alerts(
  uuid, uuid, timestamptz, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.modify_pending_order(
  actor_user_id uuid,
  target_order_id uuid,
  expected_order_updated_at timestamptz,
  operations_text text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  order_id uuid,
  restaurant_id uuid,
  service_location_id uuid,
  order_number text,
  assigned_waiter_id uuid,
  status public.order_status,
  total_amount numeric(12, 2),
  updated_at timestamptz,
  baskets jsonb,
  inventory_movements jsonb,
  inventory_alert_transitions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_record record;
  alert_summaries jsonb;
BEGIN
  SELECT result.* INTO STRICT result_record
  FROM public.modify_pending_order_without_inventory_alerts(
    actor_user_id, target_order_id, expected_order_updated_at, operations_text,
    audit_occurred_at, audit_source_ip
  ) AS result;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inventory_alert_id', transition.inventory_alert_id,
    'inventory_movement_id', transition.inventory_movement_id,
    'inventory_item_id', transition.inventory_item_id,
    'status', transition.status,
    'threshold', transition.threshold,
    'observed_balance', transition.observed_balance,
    'occurred_at', transition.occurred_at
  ) ORDER BY transition.id), '[]'::jsonb)
  INTO alert_summaries
  FROM public.inventory_alert_transitions AS transition
  WHERE transition.inventory_movement_id IN (
    SELECT (summary.value ->> 'inventory_movement_id')::uuid
    FROM jsonb_array_elements(result_record.inventory_movements) AS summary(value)
  );

  RETURN QUERY SELECT
    result_record.order_id, result_record.restaurant_id,
    result_record.service_location_id, result_record.order_number,
    result_record.assigned_waiter_id, result_record.status,
    result_record.total_amount, result_record.updated_at, result_record.baskets,
    result_record.inventory_movements, alert_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.modify_pending_order(
  uuid, uuid, timestamptz, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.modify_pending_order(
  uuid, uuid, timestamptz, text, timestamptz, text
) TO service_role;

ALTER FUNCTION public.cancel_order(
  uuid, uuid, text, timestamptz, text
) RENAME TO cancel_order_without_inventory_alerts;
REVOKE ALL ON FUNCTION public.cancel_order_without_inventory_alerts(
  uuid, uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cancel_order(
  actor_user_id uuid,
  target_order_id uuid,
  cancellation_reason text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  order_id uuid,
  restaurant_id uuid,
  service_location_id uuid,
  order_number text,
  assigned_waiter_id uuid,
  previous_status public.order_status,
  status public.order_status,
  total_amount numeric(12, 2),
  reason text,
  cancelled_by_id uuid,
  cancelled_at timestamptz,
  updated_at timestamptz,
  inventory_movements jsonb,
  inventory_alert_transitions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_record record;
  alert_summaries jsonb;
BEGIN
  SELECT result.* INTO STRICT result_record
  FROM public.cancel_order_without_inventory_alerts(
    actor_user_id, target_order_id, cancellation_reason,
    audit_occurred_at, audit_source_ip
  ) AS result;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inventory_alert_id', transition.inventory_alert_id,
    'inventory_movement_id', transition.inventory_movement_id,
    'inventory_item_id', transition.inventory_item_id,
    'status', transition.status,
    'threshold', transition.threshold,
    'observed_balance', transition.observed_balance,
    'occurred_at', transition.occurred_at
  ) ORDER BY transition.id), '[]'::jsonb)
  INTO alert_summaries
  FROM public.inventory_alert_transitions AS transition
  WHERE transition.inventory_movement_id IN (
    SELECT (summary.value ->> 'inventory_movement_id')::uuid
    FROM jsonb_array_elements(result_record.inventory_movements) AS summary(value)
  );

  RETURN QUERY SELECT
    result_record.order_id, result_record.restaurant_id,
    result_record.service_location_id, result_record.order_number,
    result_record.assigned_waiter_id, result_record.previous_status,
    result_record.status, result_record.total_amount, result_record.reason,
    result_record.cancelled_by_id, result_record.cancelled_at,
    result_record.updated_at, result_record.inventory_movements,
    alert_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(
  uuid, uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(
  uuid, uuid, text, timestamptz, text
) TO service_role;

ALTER FUNCTION public.register_inventory_purchase(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) RENAME TO register_inventory_purchase_without_inventory_alerts;
REVOKE ALL ON FUNCTION public.register_inventory_purchase_without_inventory_alerts(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

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
  lines jsonb,
  inventory_alert_transitions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_record record;
  alert_summaries jsonb;
BEGIN
  SELECT result.* INTO STRICT result_record
  FROM public.register_inventory_purchase_without_inventory_alerts(
    actor_user_id, target_restaurant_id, target_expense_category_id,
    supplier_name, purchase_reference_number, purchase_comments,
    purchase_lines_text, audit_occurred_at, audit_source_ip
  ) AS result;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inventory_alert_id', transition.inventory_alert_id,
    'inventory_movement_id', transition.inventory_movement_id,
    'inventory_item_id', transition.inventory_item_id,
    'status', transition.status,
    'threshold', transition.threshold,
    'observed_balance', transition.observed_balance,
    'occurred_at', transition.occurred_at
  ) ORDER BY transition.id), '[]'::jsonb)
  INTO alert_summaries
  FROM public.inventory_alert_transitions AS transition
  WHERE transition.inventory_movement_id IN (
    SELECT (line.value ->> 'inventoryMovementId')::uuid
    FROM jsonb_array_elements(result_record.lines) AS line(value)
  );

  RETURN QUERY SELECT
    result_record.purchase_id, result_record.restaurant_id,
    result_record.expense_category_id, result_record.operating_expense_id,
    result_record.recorded_by_id, result_record.supplier_name_result,
    result_record.reference_number, result_record.comments,
    result_record.total_amount, result_record.recorded_at,
    result_record.lines, alert_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.register_inventory_purchase(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_inventory_purchase(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) TO service_role;

ALTER FUNCTION public.register_inventory_adjustment_or_waste(
  uuid, uuid, uuid, text, text, text, timestamptz, text
) RENAME TO register_inventory_adjustment_or_waste_without_inventory_alerts;
REVOKE ALL ON FUNCTION public.register_inventory_adjustment_or_waste_without_inventory_alerts(
  uuid, uuid, uuid, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.register_inventory_adjustment_or_waste(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  movement_operation text,
  quantity_text text,
  movement_reason text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  origin_id uuid,
  inventory_movement_id uuid,
  restaurant_id uuid,
  inventory_item_id uuid,
  operation_type text,
  quantity_delta numeric,
  unit_of_measure text,
  reason text,
  recorded_by_id uuid,
  recorded_at timestamptz,
  previous_balance numeric,
  new_balance numeric,
  inventory_alert_transitions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_record record;
  alert_summaries jsonb;
BEGIN
  SELECT result.* INTO STRICT result_record
  FROM public.register_inventory_adjustment_or_waste_without_inventory_alerts(
    actor_user_id, target_restaurant_id, target_inventory_item_id,
    movement_operation, quantity_text, movement_reason,
    audit_occurred_at, audit_source_ip
  ) AS result;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inventory_alert_id', transition.inventory_alert_id,
    'inventory_movement_id', transition.inventory_movement_id,
    'inventory_item_id', transition.inventory_item_id,
    'status', transition.status,
    'threshold', transition.threshold,
    'observed_balance', transition.observed_balance,
    'occurred_at', transition.occurred_at
  ) ORDER BY transition.id), '[]'::jsonb)
  INTO alert_summaries
  FROM public.inventory_alert_transitions AS transition
  WHERE transition.inventory_movement_id = result_record.inventory_movement_id;

  RETURN QUERY SELECT
    result_record.origin_id, result_record.inventory_movement_id,
    result_record.restaurant_id, result_record.inventory_item_id,
    result_record.operation_type, result_record.quantity_delta,
    result_record.unit_of_measure, result_record.reason,
    result_record.recorded_by_id, result_record.recorded_at,
    result_record.previous_balance, result_record.new_balance,
    alert_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.register_inventory_adjustment_or_waste(
  uuid, uuid, uuid, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_inventory_adjustment_or_waste(
  uuid, uuid, uuid, text, text, text, timestamptz, text
) TO service_role;
