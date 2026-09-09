CREATE OR REPLACE FUNCTION public.complete_production_batch(
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
#variable_conflict error
DECLARE
  v_source_ip inet;
  v_notes text;
  v_produced_quantity numeric(14, 3);
  v_recipe record;
  v_ingredient record;
  v_expected_item_count integer;
  v_locked_item_count integer;
  v_batch_id uuid := gen_random_uuid();
  v_movement_id uuid;
  v_output_movement_id uuid := gen_random_uuid();
  v_output_previous_balance numeric(14, 3);
  v_output_new_balance numeric(14, 3);
  v_ingredient_summaries jsonb := '[]'::jsonb;
  v_output_summary jsonb;
  v_alert_summaries jsonb;
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
    v_produced_quantity := produced_quantity_text::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Production quantity is invalid' USING ERRCODE = '22023';
  END;
  IF v_produced_quantity <= 0 THEN
    RAISE EXCEPTION 'Production quantity must be positive' USING ERRCODE = '22023';
  END IF;

  v_notes := NULLIF(
    regexp_replace(btrim(production_notes), '\s+', ' ', 'g'),
    ''
  );

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Production timestamp is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      v_source_ip := NULLIF(btrim(audit_source_ip), '')::inet;
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
  INTO v_recipe
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
  INTO v_expected_item_count
  FROM public.recipe_ingredients AS ingredient
  WHERE ingredient.restaurant_id = target_restaurant_id
    AND ingredient.recipe_version_id = target_recipe_version_id;
  IF v_expected_item_count < 2 OR v_expected_item_count > 101 THEN
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
      SELECT v_recipe.output_inventory_item_id
    )
    AND item.is_active
    AND item.deleted_at IS NULL
  ORDER BY item.id
  FOR UPDATE OF item;
  GET DIAGNOSTICS v_locked_item_count = ROW_COUNT;
  IF v_locked_item_count <> v_expected_item_count THEN
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
      ingredient.required_quantity * v_produced_quantity
        / v_recipe.recipe_produced_quantity,
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
  INTO v_output_previous_balance
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = target_restaurant_id
    AND movement.inventory_item_id = v_recipe.output_inventory_item_id;
  v_output_new_balance := v_output_previous_balance + v_produced_quantity;
  IF v_output_new_balance > 99999999999.999 THEN
    RAISE EXCEPTION 'Production output balance is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.production_batches (
    id, restaurant_id, recipe_version_id, status, planned_quantity,
    produced_quantity, unit_of_measure, created_by_id, completed_by_id,
    created_at, started_at, completed_at, notes
  ) VALUES (
    v_batch_id, target_restaurant_id, target_recipe_version_id, 'PLANNED',
    v_produced_quantity, NULL, v_recipe.produced_unit, actor_user_id,
    NULL, audit_occurred_at, NULL, NULL, v_notes
  );

  UPDATE public.production_batches AS batch
  SET status = 'IN_PROGRESS', started_at = audit_occurred_at
  WHERE batch.restaurant_id = target_restaurant_id
    AND batch.id = v_batch_id;

  FOR v_ingredient IN
    SELECT requirement.*
    FROM pg_temp.production_ingredient_requirements AS requirement
    ORDER BY requirement.inventory_item_id
  LOOP
    v_movement_id := gen_random_uuid();
    UPDATE pg_temp.production_ingredient_requirements AS requirement
    SET inventory_movement_id = v_movement_id
    WHERE requirement.inventory_item_id = v_ingredient.inventory_item_id;

    INSERT INTO public.inventory_movements (
      id, restaurant_id, inventory_item_id, type, quantity_delta,
      unit_of_measure, recorded_by_id, recorded_at,
      business_origin_type, business_origin_id, comments, reversed_movement_id
    ) VALUES (
      v_movement_id, target_restaurant_id, v_ingredient.inventory_item_id,
      'PRODUCTION_CONSUMPTION', -v_ingredient.required_quantity,
      v_ingredient.unit_of_measure, actor_user_id, audit_occurred_at,
      'PRODUCTION', v_batch_id, v_notes, NULL
    );

    v_ingredient_summaries := v_ingredient_summaries || jsonb_build_array(
      jsonb_build_object(
        'inventoryItemId', v_ingredient.inventory_item_id,
        'inventoryMovementId', v_movement_id,
        'quantityConsumed', v_ingredient.required_quantity,
        'unitOfMeasure', v_ingredient.unit_of_measure,
        'previousBalance', v_ingredient.previous_balance,
        'newBalance', v_ingredient.new_balance
      )
    );
  END LOOP;

  INSERT INTO public.inventory_movements (
    id, restaurant_id, inventory_item_id, type, quantity_delta,
    unit_of_measure, recorded_by_id, recorded_at,
    business_origin_type, business_origin_id, comments, reversed_movement_id
  ) VALUES (
    v_output_movement_id, target_restaurant_id,
    v_recipe.output_inventory_item_id, 'PRODUCTION_OUTPUT',
    v_produced_quantity, v_recipe.produced_unit, actor_user_id,
    audit_occurred_at, 'PRODUCTION', v_batch_id, v_notes, NULL
  );

  v_output_summary := jsonb_build_object(
    'inventoryItemId', v_recipe.output_inventory_item_id,
    'inventoryMovementId', v_output_movement_id,
    'quantityProduced', v_produced_quantity,
    'unitOfMeasure', v_recipe.produced_unit,
    'previousBalance', v_output_previous_balance,
    'newBalance', v_output_new_balance
  );

  UPDATE public.production_batches AS batch
  SET status = 'COMPLETED',
      produced_quantity = v_produced_quantity,
      completed_by_id = actor_user_id,
      completed_at = audit_occurred_at
  WHERE batch.restaurant_id = target_restaurant_id
    AND batch.id = v_batch_id;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id, audit_occurred_at, 'production_batch.completed',
    'production_batch', v_batch_id::text, NULL,
    jsonb_build_object(
      'batchId', v_batch_id,
      'restaurantId', target_restaurant_id,
      'recipeId', v_recipe.recipe_id,
      'recipeVersionId', target_recipe_version_id,
      'recipeVersionNumber', v_recipe.version_number,
      'productId', v_recipe.product_id,
      'status', 'COMPLETED',
      'producedQuantity', v_produced_quantity,
      'unitOfMeasure', v_recipe.produced_unit,
      'completedById', actor_user_id,
      'completedAt', audit_occurred_at,
      'notes', v_notes,
      'ingredientMovements', v_ingredient_summaries,
      'outputMovement', v_output_summary
    ),
    v_source_ip
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
  INTO v_alert_summaries
  FROM public.inventory_alert_transitions AS transition
  JOIN public.inventory_movements AS movement
    ON movement.restaurant_id = transition.restaurant_id
   AND movement.inventory_item_id = transition.inventory_item_id
   AND movement.id = transition.inventory_movement_id
  WHERE movement.restaurant_id = target_restaurant_id
    AND movement.business_origin_type = 'PRODUCTION'
    AND movement.business_origin_id = v_batch_id;

  RETURN QUERY SELECT
    v_batch_id,
    target_restaurant_id,
    v_recipe.recipe_id::uuid,
    target_recipe_version_id,
    v_recipe.version_number::integer,
    v_recipe.product_id::uuid,
    'COMPLETED'::public.production_batch_status,
    v_produced_quantity,
    v_recipe.produced_unit::text,
    actor_user_id,
    audit_occurred_at,
    v_notes,
    v_ingredient_summaries,
    v_output_summary,
    v_alert_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_production_batch(
  uuid, uuid, uuid, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_production_batch(
  uuid, uuid, uuid, text, text, timestamptz, text
) TO service_role;
