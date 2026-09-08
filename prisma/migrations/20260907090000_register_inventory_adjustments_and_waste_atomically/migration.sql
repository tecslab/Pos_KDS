CREATE TABLE public.inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL,
  quantity_delta numeric(14, 3) NOT NULL,
  unit_of_measure text NOT NULL,
  reason text NOT NULL,
  recorded_by_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_adjustments_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_adjustments_item_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_adjustments_movement_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id, inventory_movement_id)
      REFERENCES public.inventory_movements(restaurant_id, inventory_item_id, id)
      ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT inventory_adjustments_recorded_by_fkey
    FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_adjustments_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT inventory_adjustments_item_movement_key UNIQUE (restaurant_id, inventory_item_id, inventory_movement_id),
  CONSTRAINT inventory_adjustments_movement_key UNIQUE (restaurant_id, inventory_movement_id),
  CONSTRAINT inventory_adjustments_quantity_nonzero CHECK (quantity_delta <> 0),
  CONSTRAINT inventory_adjustments_unit_not_blank CHECK (btrim(unit_of_measure) <> ''),
  CONSTRAINT inventory_adjustments_reason_valid CHECK (btrim(reason) <> '' AND length(reason) <= 2000)
);

CREATE INDEX inventory_adjustments_item_recorded_idx
  ON public.inventory_adjustments(restaurant_id, inventory_item_id, recorded_at);
CREATE INDEX inventory_adjustments_recorder_recorded_idx
  ON public.inventory_adjustments(recorded_by_id, recorded_at);

CREATE TABLE public.inventory_waste_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL,
  quantity numeric(14, 3) NOT NULL,
  unit_of_measure text NOT NULL,
  reason text NOT NULL,
  recorded_by_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_waste_records_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_waste_records_item_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_waste_records_movement_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id, inventory_movement_id)
      REFERENCES public.inventory_movements(restaurant_id, inventory_item_id, id)
      ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT inventory_waste_records_recorded_by_fkey
    FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_waste_records_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT inventory_waste_records_item_movement_key UNIQUE (restaurant_id, inventory_item_id, inventory_movement_id),
  CONSTRAINT inventory_waste_records_movement_key UNIQUE (restaurant_id, inventory_movement_id),
  CONSTRAINT inventory_waste_records_quantity_positive CHECK (quantity > 0),
  CONSTRAINT inventory_waste_records_unit_not_blank CHECK (btrim(unit_of_measure) <> ''),
  CONSTRAINT inventory_waste_records_reason_valid CHECK (btrim(reason) <> '' AND length(reason) <= 2000)
);

CREATE INDEX inventory_waste_records_item_recorded_idx
  ON public.inventory_waste_records(restaurant_id, inventory_item_id, recorded_at);
CREATE INDEX inventory_waste_records_recorder_recorded_idx
  ON public.inventory_waste_records(recorded_by_id, recorded_at);

CREATE FUNCTION public.reject_inventory_adjustment_waste_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inventory_adjustments_immutable
BEFORE UPDATE OR DELETE ON public.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_adjustment_waste_history_mutation();

CREATE TRIGGER inventory_waste_records_immutable
BEFORE UPDATE OR DELETE ON public.inventory_waste_records
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_adjustment_waste_history_mutation();

CREATE FUNCTION public.assert_inventory_adjustment_integrity(
  restaurant_id_to_check uuid,
  adjustment_id_to_check uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  adjustment_record public.inventory_adjustments%ROWTYPE;
  movement_count integer;
BEGIN
  SELECT adjustment.*
  INTO adjustment_record
  FROM public.inventory_adjustments AS adjustment
  WHERE adjustment.restaurant_id = restaurant_id_to_check
    AND adjustment.id = adjustment_id_to_check;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory adjustment origin does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT count(*)
  INTO movement_count
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = adjustment_record.restaurant_id
    AND movement.business_origin_type = 'ADJUSTMENT'
    AND movement.business_origin_id = adjustment_record.id;

  IF movement_count <> 1 THEN
    RAISE EXCEPTION 'inventory adjustment movement origin is not exclusive' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements AS movement
    WHERE movement.restaurant_id = adjustment_record.restaurant_id
      AND movement.inventory_item_id = adjustment_record.inventory_item_id
      AND movement.id = adjustment_record.inventory_movement_id
      AND movement.type = 'ADJUSTMENT'
      AND movement.quantity_delta = adjustment_record.quantity_delta
      AND movement.unit_of_measure = adjustment_record.unit_of_measure
      AND movement.recorded_by_id = adjustment_record.recorded_by_id
      AND movement.recorded_at = adjustment_record.recorded_at
      AND movement.business_origin_type = 'ADJUSTMENT'
      AND movement.business_origin_id = adjustment_record.id
      AND movement.comments = adjustment_record.reason
      AND movement.reversed_movement_id IS NULL
  ) THEN
    RAISE EXCEPTION 'inventory adjustment movement is inconsistent' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_inventory_waste_integrity(
  restaurant_id_to_check uuid,
  waste_id_to_check uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  waste_record public.inventory_waste_records%ROWTYPE;
  movement_count integer;
BEGIN
  SELECT waste.*
  INTO waste_record
  FROM public.inventory_waste_records AS waste
  WHERE waste.restaurant_id = restaurant_id_to_check
    AND waste.id = waste_id_to_check;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory waste origin does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT count(*)
  INTO movement_count
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = waste_record.restaurant_id
    AND movement.business_origin_type = 'WASTE'
    AND movement.business_origin_id = waste_record.id;

  IF movement_count <> 1 THEN
    RAISE EXCEPTION 'inventory waste movement origin is not exclusive' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements AS movement
    WHERE movement.restaurant_id = waste_record.restaurant_id
      AND movement.inventory_item_id = waste_record.inventory_item_id
      AND movement.id = waste_record.inventory_movement_id
      AND movement.type = 'WASTE'
      AND movement.quantity_delta = -waste_record.quantity
      AND movement.unit_of_measure = waste_record.unit_of_measure
      AND movement.recorded_by_id = waste_record.recorded_by_id
      AND movement.recorded_at = waste_record.recorded_at
      AND movement.business_origin_type = 'WASTE'
      AND movement.business_origin_id = waste_record.id
      AND movement.comments = waste_record.reason
      AND movement.reversed_movement_id IS NULL
  ) THEN
    RAISE EXCEPTION 'inventory waste movement is inconsistent' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.check_inventory_adjustment_waste_integrity_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'inventory_adjustments' THEN
    PERFORM public.assert_inventory_adjustment_integrity(NEW.restaurant_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'inventory_waste_records' THEN
    PERFORM public.assert_inventory_waste_integrity(NEW.restaurant_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'inventory_movements' THEN
    IF NEW.business_origin_type = 'ADJUSTMENT' THEN
      PERFORM public.assert_inventory_adjustment_integrity(NEW.restaurant_id, NEW.business_origin_id);
    ELSIF NEW.business_origin_type = 'WASTE' THEN
      PERFORM public.assert_inventory_waste_integrity(NEW.restaurant_id, NEW.business_origin_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER inventory_adjustments_integrity_deferred
AFTER INSERT ON public.inventory_adjustments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_adjustment_waste_integrity_deferred();

CREATE CONSTRAINT TRIGGER inventory_waste_records_integrity_deferred
AFTER INSERT ON public.inventory_waste_records
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_adjustment_waste_integrity_deferred();

CREATE CONSTRAINT TRIGGER adjustment_waste_movements_integrity_deferred
AFTER INSERT ON public.inventory_movements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_inventory_adjustment_waste_integrity_deferred();

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_waste_records ENABLE ROW LEVEL SECURITY;

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
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_reason text;
  source_ip_value inet;
  required_permission text;
  item_unit text;
  allow_negative_stock boolean;
  quantity_value numeric(14, 3);
  quantity_delta_value numeric(14, 3);
  previous_balance_value numeric(14, 3);
  new_balance_value numeric(14, 3);
  new_origin_id uuid := gen_random_uuid();
  new_movement_id uuid := gen_random_uuid();
BEGIN
  IF actor_user_id IS NULL
    OR target_restaurant_id IS NULL
    OR target_inventory_item_id IS NULL
    OR movement_operation NOT IN ('ADJUSTMENT', 'WASTE')
    OR quantity_text IS NULL
    OR movement_reason IS NULL
    OR audit_occurred_at IS NULL
    OR length(btrim(movement_reason)) > 2000
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'Inventory adjustment or waste input is invalid' USING ERRCODE = '22023';
  END IF;

  normalized_reason := NULLIF(regexp_replace(btrim(movement_reason), '\s+', ' ', 'g'), '');
  IF normalized_reason IS NULL OR length(normalized_reason) > 2000 THEN
    RAISE EXCEPTION 'Inventory movement reason is required' USING ERRCODE = '22023';
  END IF;

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Inventory movement timestamp is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := NULLIF(btrim(audit_source_ip), '')::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Inventory movement audit source IP is invalid' USING ERRCODE = '22023';
    END;
  END IF;

  IF movement_operation = 'ADJUSTMENT' THEN
    IF quantity_text !~ '^-?[0-9]{1,11}(\.[0-9]{1,3})?$' THEN
      RAISE EXCEPTION 'Inventory adjustment quantity is invalid' USING ERRCODE = '22023';
    END IF;
    required_permission := 'inventory.adjustments.register';
  ELSE
    IF quantity_text !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' THEN
      RAISE EXCEPTION 'Inventory waste quantity is invalid' USING ERRCODE = '22023';
    END IF;
    required_permission := 'inventory.waste.register';
  END IF;

  BEGIN
    quantity_value := quantity_text::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Inventory movement quantity is invalid' USING ERRCODE = '22023';
  END;
  IF quantity_value = 0 THEN
    RAISE EXCEPTION 'Inventory movement quantity must be nonzero' USING ERRCODE = '22023';
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
    AND permission.code = required_permission
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory adjustment or waste registration is unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.restaurants AS restaurant
  WHERE restaurant.id = target_restaurant_id
    AND restaurant.is_active
    AND restaurant.deleted_at IS NULL
  FOR KEY SHARE OF restaurant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_RESTAURANT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT item.unit_of_measure,
         (configuration.inventory_policy ->> 'allowNegativeStock')::boolean
  INTO item_unit, allow_negative_stock
  FROM public.inventory_items AS item
  JOIN public.restaurant_configurations AS configuration
    ON configuration.restaurant_id = item.restaurant_id
  WHERE item.restaurant_id = target_restaurant_id
    AND item.id = target_inventory_item_id
    AND item.is_active
    AND item.deleted_at IS NULL
  FOR UPDATE OF item;
  IF NOT FOUND OR allow_negative_stock IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_ITEM_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(movement.quantity_delta), 0)
  INTO previous_balance_value
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = target_restaurant_id
    AND movement.inventory_item_id = target_inventory_item_id;

  quantity_delta_value := CASE
    WHEN movement_operation = 'WASTE' THEN -quantity_value
    ELSE quantity_value
  END;
  new_balance_value := previous_balance_value + quantity_delta_value;

  IF new_balance_value < 0 AND NOT allow_negative_stock THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_NEGATIVE_STOCK_DISALLOWED' USING ERRCODE = 'P0001';
  END IF;

  IF movement_operation = 'ADJUSTMENT' THEN
    INSERT INTO public.inventory_adjustments (
      id, restaurant_id, inventory_item_id, inventory_movement_id,
      quantity_delta, unit_of_measure, reason, recorded_by_id, recorded_at
    ) VALUES (
      new_origin_id, target_restaurant_id, target_inventory_item_id,
      new_movement_id, quantity_delta_value, item_unit, normalized_reason,
      actor_user_id, audit_occurred_at
    );
  ELSE
    INSERT INTO public.inventory_waste_records (
      id, restaurant_id, inventory_item_id, inventory_movement_id,
      quantity, unit_of_measure, reason, recorded_by_id, recorded_at
    ) VALUES (
      new_origin_id, target_restaurant_id, target_inventory_item_id,
      new_movement_id, quantity_value, item_unit, normalized_reason,
      actor_user_id, audit_occurred_at
    );
  END IF;

  INSERT INTO public.inventory_movements (
    id, restaurant_id, inventory_item_id, type, quantity_delta,
    unit_of_measure, recorded_by_id, recorded_at,
    business_origin_type, business_origin_id, comments, reversed_movement_id
  ) VALUES (
    new_movement_id, target_restaurant_id, target_inventory_item_id,
    movement_operation::public.inventory_movement_type, quantity_delta_value,
    item_unit, actor_user_id, audit_occurred_at,
    movement_operation::public.inventory_business_origin_type, new_origin_id,
    normalized_reason, NULL
  );

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id,
    audit_occurred_at,
    CASE WHEN movement_operation = 'ADJUSTMENT'
      THEN 'inventory_adjustment.registered'
      ELSE 'inventory_waste.registered'
    END,
    CASE WHEN movement_operation = 'ADJUSTMENT'
      THEN 'inventory_adjustment'
      ELSE 'inventory_waste_record'
    END,
    new_origin_id::text,
    jsonb_build_object(
      'restaurantId', target_restaurant_id,
      'inventoryItemId', target_inventory_item_id,
      'balance', previous_balance_value
    ),
    jsonb_build_object(
      'originId', new_origin_id,
      'inventoryMovementId', new_movement_id,
      'restaurantId', target_restaurant_id,
      'inventoryItemId', target_inventory_item_id,
      'operation', movement_operation,
      'quantityDelta', quantity_delta_value,
      'unitOfMeasure', item_unit,
      'reason', normalized_reason,
      'recordedById', actor_user_id,
      'recordedAt', audit_occurred_at,
      'balance', new_balance_value
    ),
    source_ip_value
  );

  RETURN QUERY SELECT
    new_origin_id,
    new_movement_id,
    target_restaurant_id,
    target_inventory_item_id,
    movement_operation,
    quantity_delta_value,
    item_unit,
    normalized_reason,
    actor_user_id,
    audit_occurred_at,
    previous_balance_value,
    new_balance_value;
END;
$$;

REVOKE ALL ON FUNCTION public.register_inventory_adjustment_or_waste(
  uuid, uuid, uuid, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_inventory_adjustment_or_waste(
  uuid, uuid, uuid, text, text, text, timestamptz, text
) TO service_role;
