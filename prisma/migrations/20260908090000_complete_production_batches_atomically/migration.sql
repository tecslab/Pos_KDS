CREATE FUNCTION public.assert_production_batch_integrity(
  restaurant_id_to_check uuid,
  batch_id_to_check uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  batch_record public.production_batches%ROWTYPE;
  recipe_record record;
  movement_count integer;
  ingredient_count integer;
BEGIN
  SELECT batch.*
  INTO batch_record
  FROM public.production_batches AS batch
  WHERE batch.restaurant_id = restaurant_id_to_check
    AND batch.id = batch_id_to_check;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production batch origin does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT
    recipe.output_inventory_item_id,
    version.produced_quantity AS recipe_produced_quantity
  INTO recipe_record
  FROM public.recipe_versions AS version
  JOIN public.recipes AS recipe
    ON recipe.restaurant_id = version.restaurant_id
   AND recipe.id = version.recipe_id
  WHERE version.restaurant_id = batch_record.restaurant_id
    AND version.id = batch_record.recipe_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production batch recipe version does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT count(*)
  INTO movement_count
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = batch_record.restaurant_id
    AND movement.business_origin_type = 'PRODUCTION'
    AND movement.business_origin_id = batch_record.id;

  IF batch_record.status <> 'COMPLETED' THEN
    IF movement_count <> 0 THEN
      RAISE EXCEPTION 'unfinished production batch cannot own inventory movements'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  SELECT count(*)
  INTO ingredient_count
  FROM public.recipe_ingredients AS ingredient
  WHERE ingredient.restaurant_id = batch_record.restaurant_id
    AND ingredient.recipe_version_id = batch_record.recipe_version_id;

  IF ingredient_count < 1 OR ingredient_count > 100
    OR movement_count <> ingredient_count + 1 THEN
    RAISE EXCEPTION 'production batch movement origin is incomplete or not exclusive'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements AS movement
    WHERE movement.restaurant_id = batch_record.restaurant_id
      AND movement.inventory_item_id = recipe_record.output_inventory_item_id
      AND movement.type = 'PRODUCTION_OUTPUT'
      AND movement.quantity_delta = batch_record.produced_quantity
      AND movement.unit_of_measure = batch_record.unit_of_measure
      AND movement.recorded_by_id = batch_record.completed_by_id
      AND movement.recorded_at = batch_record.completed_at
      AND movement.business_origin_type = 'PRODUCTION'
      AND movement.business_origin_id = batch_record.id
      AND movement.comments IS NOT DISTINCT FROM batch_record.notes
      AND movement.reversed_movement_id IS NULL
  ) THEN
    RAISE EXCEPTION 'production output movement is inconsistent' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.recipe_ingredients AS ingredient
    WHERE ingredient.restaurant_id = batch_record.restaurant_id
      AND ingredient.recipe_version_id = batch_record.recipe_version_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_movements AS movement
        WHERE movement.restaurant_id = batch_record.restaurant_id
          AND movement.inventory_item_id = ingredient.inventory_item_id
          AND movement.type = 'PRODUCTION_CONSUMPTION'
          AND movement.quantity_delta = -round(
            ingredient.required_quantity * batch_record.produced_quantity
              / recipe_record.recipe_produced_quantity,
            3
          )
          AND movement.unit_of_measure = ingredient.unit_of_measure
          AND movement.recorded_by_id = batch_record.completed_by_id
          AND movement.recorded_at = batch_record.completed_at
          AND movement.business_origin_type = 'PRODUCTION'
          AND movement.business_origin_id = batch_record.id
          AND movement.comments IS NOT DISTINCT FROM batch_record.notes
          AND movement.reversed_movement_id IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'production ingredient movement is inconsistent' USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_production_batch_integrity(uuid, uuid)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.check_production_batch_integrity_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'production_batches' THEN
    PERFORM public.assert_production_batch_integrity(NEW.restaurant_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'inventory_movements'
    AND NEW.business_origin_type = 'PRODUCTION' THEN
    PERFORM public.assert_production_batch_integrity(
      NEW.restaurant_id,
      NEW.business_origin_id
    );
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.check_production_batch_integrity_deferred()
FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER production_batches_integrity_deferred
AFTER INSERT OR UPDATE ON public.production_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_production_batch_integrity_deferred();

CREATE CONSTRAINT TRIGGER production_movements_integrity_deferred
AFTER INSERT ON public.inventory_movements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_production_batch_integrity_deferred();

CREATE FUNCTION public.complete_production_batch(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_recipe_version_id uuid,
  produced_quantity_text text,
  production_notes text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  batch_id uuid,
  restaurant_id uuid,
  recipe_id uuid,
  recipe_version_id uuid,
  recipe_version_number integer,
  product_id uuid,
  status public.production_batch_status,
  produced_quantity numeric,
  unit_of_measure text,
  completed_by_id uuid,
  completed_at timestamptz,
  notes text,
  ingredient_movements jsonb,
  output_movement jsonb,
  inventory_alert_transitions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  source_ip_value inet;
  normalized_notes text;
  produced_quantity_value numeric(14, 3);
  recipe_record record;
  ingredient_record record;
  expected_item_count integer;
  locked_item_count integer;
  new_batch_id uuid := gen_random_uuid();
  new_movement_id uuid;
  output_movement_id uuid := gen_random_uuid();
  output_previous_balance numeric(14, 3);
  output_new_balance numeric(14, 3);
  ingredient_summaries jsonb := '[]'::jsonb;
  output_summary jsonb;
  alert_summaries jsonb;
BEGIN
  IF actor_user_id IS NULL
    OR target_restaurant_id IS NULL
    OR target_recipe_version_id IS NULL
    OR produced_quantity_text IS NULL
    OR audit_occurred_at IS NULL
    OR produced_quantity_text !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$'
    OR (production_notes IS NOT NULL AND length(btrim(production_notes)) > 2000)
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'Production batch input is invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    produced_quantity_value := produced_quantity_text::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Production quantity is invalid' USING ERRCODE = '22023';
  END;
  IF produced_quantity_value <= 0 THEN
    RAISE EXCEPTION 'Production quantity must be positive' USING ERRCODE = '22023';
  END IF;

  normalized_notes := NULLIF(
    regexp_replace(btrim(production_notes), '\s+', ' ', 'g'),
    ''
  );

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Production timestamp is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := NULLIF(btrim(audit_source_ip), '')::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Production audit source IP is invalid' USING ERRCODE = '22023';
    END;
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
    AND permission.code = 'production.batch.create'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production batch completion is unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.restaurants AS restaurant
  WHERE restaurant.id = target_restaurant_id
    AND restaurant.is_active
    AND restaurant.deleted_at IS NULL
  FOR KEY SHARE OF restaurant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCTION_RESTAURANT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    version.recipe_id,
    version.version_number,
    version.produced_quantity AS recipe_produced_quantity,
    version.produced_unit,
    recipe.product_id,
    recipe.output_inventory_item_id
  INTO recipe_record
  FROM public.recipe_versions AS version
  JOIN public.recipes AS recipe
    ON recipe.restaurant_id = version.restaurant_id
   AND recipe.id = version.recipe_id
  WHERE version.restaurant_id = target_restaurant_id
    AND version.id = target_recipe_version_id
    AND recipe.is_active
    AND recipe.deleted_at IS NULL
  FOR KEY SHARE OF version, recipe;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCTION_RECIPE_VERSION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) + 1
  INTO expected_item_count
  FROM public.recipe_ingredients AS ingredient
  WHERE ingredient.restaurant_id = target_restaurant_id
    AND ingredient.recipe_version_id = target_recipe_version_id;
  IF expected_item_count < 2 OR expected_item_count > 101 THEN
    RAISE EXCEPTION 'Production recipe ingredient count is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM item.id
  FROM public.inventory_items AS item
  WHERE item.restaurant_id = target_restaurant_id
    AND item.id IN (
      SELECT ingredient.inventory_item_id
      FROM public.recipe_ingredients AS ingredient
      WHERE ingredient.restaurant_id = target_restaurant_id
        AND ingredient.recipe_version_id = target_recipe_version_id
      UNION
      SELECT recipe_record.output_inventory_item_id
    )
    AND item.is_active
    AND item.deleted_at IS NULL
  ORDER BY item.id
  FOR UPDATE OF item;
  GET DIAGNOSTICS locked_item_count = ROW_COUNT;
  IF locked_item_count <> expected_item_count THEN
    RAISE EXCEPTION 'PRODUCTION_INVENTORY_ITEM_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMP TABLE pg_temp.production_ingredient_requirements (
    inventory_item_id uuid PRIMARY KEY,
    required_quantity numeric NOT NULL,
    unit_of_measure text NOT NULL,
    previous_balance numeric(14, 3),
    new_balance numeric(14, 3),
    inventory_movement_id uuid
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.production_ingredient_requirements (
    inventory_item_id, required_quantity, unit_of_measure
  )
  SELECT
    ingredient.inventory_item_id,
    round(
      ingredient.required_quantity * produced_quantity_value
        / recipe_record.recipe_produced_quantity,
      3
    ),
    ingredient.unit_of_measure
  FROM public.recipe_ingredients AS ingredient
  WHERE ingredient.restaurant_id = target_restaurant_id
    AND ingredient.recipe_version_id = target_recipe_version_id;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.production_ingredient_requirements AS requirement
    WHERE requirement.required_quantity <= 0
      OR requirement.required_quantity > 99999999999.999
  ) THEN
    RAISE EXCEPTION 'Production ingredient quantity is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE pg_temp.production_ingredient_requirements AS requirement
  SET previous_balance = balance.current_balance,
      new_balance = balance.current_balance - requirement.required_quantity
  FROM (
    SELECT
      requirement_balance.inventory_item_id,
      COALESCE(sum(movement.quantity_delta), 0)::numeric(14, 3) AS current_balance
    FROM pg_temp.production_ingredient_requirements AS requirement_balance
    LEFT JOIN public.inventory_movements AS movement
      ON movement.restaurant_id = target_restaurant_id
     AND movement.inventory_item_id = requirement_balance.inventory_item_id
    GROUP BY requirement_balance.inventory_item_id
  ) AS balance
  WHERE balance.inventory_item_id = requirement.inventory_item_id;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.production_ingredient_requirements AS requirement
    WHERE requirement.previous_balance < requirement.required_quantity
  ) THEN
    RAISE EXCEPTION 'PRODUCTION_INSUFFICIENT_INVENTORY' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(movement.quantity_delta), 0)::numeric(14, 3)
  INTO output_previous_balance
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = target_restaurant_id
    AND movement.inventory_item_id = recipe_record.output_inventory_item_id;
  output_new_balance := output_previous_balance + produced_quantity_value;
  IF output_new_balance > 99999999999.999 THEN
    RAISE EXCEPTION 'Production output balance is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.production_batches (
    id, restaurant_id, recipe_version_id, status, planned_quantity,
    produced_quantity, unit_of_measure, created_by_id, completed_by_id,
    created_at, started_at, completed_at, notes
  ) VALUES (
    new_batch_id, target_restaurant_id, target_recipe_version_id, 'PLANNED',
    produced_quantity_value, NULL, recipe_record.produced_unit, actor_user_id,
    NULL, audit_occurred_at, NULL, NULL, normalized_notes
  );

  UPDATE public.production_batches
  SET status = 'IN_PROGRESS', started_at = audit_occurred_at
  WHERE restaurant_id = target_restaurant_id AND id = new_batch_id;

  FOR ingredient_record IN
    SELECT *
    FROM pg_temp.production_ingredient_requirements
    ORDER BY inventory_item_id
  LOOP
    new_movement_id := gen_random_uuid();
    UPDATE pg_temp.production_ingredient_requirements AS requirement
    SET inventory_movement_id = new_movement_id
    WHERE requirement.inventory_item_id = ingredient_record.inventory_item_id;

    INSERT INTO public.inventory_movements (
      id, restaurant_id, inventory_item_id, type, quantity_delta,
      unit_of_measure, recorded_by_id, recorded_at,
      business_origin_type, business_origin_id, comments, reversed_movement_id
    ) VALUES (
      new_movement_id, target_restaurant_id, ingredient_record.inventory_item_id,
      'PRODUCTION_CONSUMPTION', -ingredient_record.required_quantity,
      ingredient_record.unit_of_measure, actor_user_id, audit_occurred_at,
      'PRODUCTION', new_batch_id, normalized_notes, NULL
    );

    ingredient_summaries := ingredient_summaries || jsonb_build_array(
      jsonb_build_object(
        'inventoryItemId', ingredient_record.inventory_item_id,
        'inventoryMovementId', new_movement_id,
        'quantityConsumed', ingredient_record.required_quantity,
        'unitOfMeasure', ingredient_record.unit_of_measure,
        'previousBalance', ingredient_record.previous_balance,
        'newBalance', ingredient_record.new_balance
      )
    );
  END LOOP;

  INSERT INTO public.inventory_movements (
    id, restaurant_id, inventory_item_id, type, quantity_delta,
    unit_of_measure, recorded_by_id, recorded_at,
    business_origin_type, business_origin_id, comments, reversed_movement_id
  ) VALUES (
    output_movement_id, target_restaurant_id,
    recipe_record.output_inventory_item_id, 'PRODUCTION_OUTPUT',
    produced_quantity_value, recipe_record.produced_unit, actor_user_id,
    audit_occurred_at, 'PRODUCTION', new_batch_id, normalized_notes, NULL
  );

  output_summary := jsonb_build_object(
    'inventoryItemId', recipe_record.output_inventory_item_id,
    'inventoryMovementId', output_movement_id,
    'quantityProduced', produced_quantity_value,
    'unitOfMeasure', recipe_record.produced_unit,
    'previousBalance', output_previous_balance,
    'newBalance', output_new_balance
  );

  UPDATE public.production_batches
  SET status = 'COMPLETED',
      produced_quantity = produced_quantity_value,
      completed_by_id = actor_user_id,
      completed_at = audit_occurred_at
  WHERE restaurant_id = target_restaurant_id AND id = new_batch_id;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id, audit_occurred_at, 'production_batch.completed',
    'production_batch', new_batch_id::text, NULL,
    jsonb_build_object(
      'batchId', new_batch_id,
      'restaurantId', target_restaurant_id,
      'recipeId', recipe_record.recipe_id,
      'recipeVersionId', target_recipe_version_id,
      'recipeVersionNumber', recipe_record.version_number,
      'productId', recipe_record.product_id,
      'status', 'COMPLETED',
      'producedQuantity', produced_quantity_value,
      'unitOfMeasure', recipe_record.produced_unit,
      'completedById', actor_user_id,
      'completedAt', audit_occurred_at,
      'notes', normalized_notes,
      'ingredientMovements', ingredient_summaries,
      'outputMovement', output_summary
    ),
    source_ip_value
  );

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
  WHERE movement.restaurant_id = target_restaurant_id
    AND movement.business_origin_type = 'PRODUCTION'
    AND movement.business_origin_id = new_batch_id;

  RETURN QUERY SELECT
    new_batch_id,
    target_restaurant_id,
    recipe_record.recipe_id::uuid,
    target_recipe_version_id,
    recipe_record.version_number::integer,
    recipe_record.product_id::uuid,
    'COMPLETED'::public.production_batch_status,
    produced_quantity_value,
    recipe_record.produced_unit::text,
    actor_user_id,
    audit_occurred_at,
    normalized_notes,
    ingredient_summaries,
    output_summary,
    alert_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_production_batch(
  uuid, uuid, uuid, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_production_batch(
  uuid, uuid, uuid, text, text, timestamptz, text
) TO service_role;
