CREATE FUNCTION public.save_recipe(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_recipe_id uuid,
  target_recipe_version_id uuid,
  expected_previous_version_number integer,
  target_product_id uuid,
  target_output_inventory_item_id uuid,
  recipe_name text,
  recipe_is_active boolean,
  recipe_produced_quantity numeric,
  recipe_ingredients_text text,
  audit_event_text text
)
RETURNS SETOF public.recipe_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_recipe public.recipes%ROWTYPE;
  current_version public.recipe_versions%ROWTYPE;
  recipe_exists boolean;
  current_version_number integer;
  next_version_number integer;
  configured_output_unit text;
  configured_ingredient_unit text;
  ingredients_json jsonb;
  normalized_ingredients jsonb := '[]'::jsonb;
  ingredient jsonb;
  ingredient_ids uuid[];
  inventory_item_ids uuid[];
  ingredient_id uuid;
  inventory_item_id uuid;
  required_quantity numeric(14, 3);
  current_ingredients jsonb;
  audit_event jsonb;
  previous_values jsonb;
  next_values jsonb;
  expected_action text;
BEGIN
  IF actor_user_id IS NULL OR target_restaurant_id IS NULL
    OR target_recipe_id IS NULL OR target_recipe_version_id IS NULL
    OR expected_previous_version_number IS NULL
    OR expected_previous_version_number < 0
    OR target_product_id IS NULL OR target_output_inventory_item_id IS NULL
    OR recipe_name IS NULL OR btrim(recipe_name) = ''
    OR recipe_name IS DISTINCT FROM btrim(recipe_name)
    OR length(recipe_name) > 120
    OR recipe_is_active IS NULL
    OR recipe_produced_quantity IS NULL
    OR recipe_produced_quantity <= 0
    OR recipe_produced_quantity > 99999999999.999
    OR recipe_produced_quantity::numeric(14, 3) IS DISTINCT FROM recipe_produced_quantity THEN
    RAISE EXCEPTION 'recipe input is invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    ingredients_json := recipe_ingredients_text::jsonb;
    audit_event := audit_event_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'recipe JSON input is invalid' USING ERRCODE = '22023';
  END;

  IF jsonb_typeof(ingredients_json) IS DISTINCT FROM 'array'
    OR jsonb_array_length(ingredients_json) < 1
    OR jsonb_array_length(ingredients_json) > 100 THEN
    RAISE EXCEPTION 'recipe ingredients are invalid' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(audit_event) IS DISTINCT FROM 'object'
    OR audit_event ->> 'actorId' IS DISTINCT FROM actor_user_id::text
    OR audit_event ->> 'entityType' IS DISTINCT FROM 'recipe'
    OR audit_event ->> 'entityId' IS DISTINCT FROM target_recipe_id::text
    OR jsonb_typeof(audit_event -> 'newValues') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_recipe_id::text, 0));

  PERFORM 1
  FROM public.application_users
  WHERE id = actor_user_id AND is_active
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipe actor was not found' USING ERRCODE = '23503';
  END IF;

  PERFORM 1
  FROM public.restaurants
  WHERE id = target_restaurant_id
    AND is_active
    AND deleted_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipe restaurant was not found' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO current_recipe
  FROM public.recipes
  WHERE id = target_recipe_id
    AND restaurant_id = target_restaurant_id
    AND deleted_at IS NULL
  FOR UPDATE;
  recipe_exists := FOUND;

  PERFORM 1
  FROM public.products
  WHERE id = target_product_id
    AND restaurant_id = target_restaurant_id
    AND is_active
    AND deleted_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipe product was not found' USING ERRCODE = '23503';
  END IF;

  SELECT unit_of_measure INTO configured_output_unit
  FROM public.inventory_items
  WHERE id = target_output_inventory_item_id
    AND restaurant_id = target_restaurant_id
    AND type = 'PRODUCED_ITEM'
    AND is_active
    AND deleted_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipe output item is not eligible' USING ERRCODE = '23514';
  END IF;

  FOR ingredient IN SELECT value FROM jsonb_array_elements(ingredients_json)
  LOOP
    IF jsonb_typeof(ingredient) IS DISTINCT FROM 'object'
      OR jsonb_typeof(ingredient -> 'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(ingredient -> 'inventoryItemId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(ingredient -> 'requiredQuantity') IS DISTINCT FROM 'number'
      OR jsonb_typeof(ingredient -> 'unitOfMeasure') IS DISTINCT FROM 'string'
      OR (ingredient ->> 'requiredQuantity') !~ '^\d{1,11}(\.\d{1,3})?$'
      OR btrim(ingredient ->> 'unitOfMeasure') = ''
      OR ingredient ->> 'unitOfMeasure' IS DISTINCT FROM btrim(ingredient ->> 'unitOfMeasure') THEN
      RAISE EXCEPTION 'recipe ingredient is invalid' USING ERRCODE = '22023';
    END IF;

    ingredient_id := (ingredient ->> 'id')::uuid;
    inventory_item_id := (ingredient ->> 'inventoryItemId')::uuid;
    required_quantity := (ingredient ->> 'requiredQuantity')::numeric(14, 3);
    IF required_quantity <= 0
      OR required_quantity > 99999999999.999
      OR ingredient_id = ANY(COALESCE(ingredient_ids, ARRAY[]::uuid[]))
      OR inventory_item_id = ANY(COALESCE(inventory_item_ids, ARRAY[]::uuid[])) THEN
      RAISE EXCEPTION 'recipe ingredient is duplicated or out of range' USING ERRCODE = '22023';
    END IF;

    SELECT unit_of_measure INTO configured_ingredient_unit
    FROM public.inventory_items
    WHERE id = inventory_item_id
      AND restaurant_id = target_restaurant_id
      AND type = 'RAW_INGREDIENT'
      AND is_active
      AND deleted_at IS NULL
    FOR KEY SHARE;
    IF NOT FOUND OR configured_ingredient_unit IS DISTINCT FROM ingredient ->> 'unitOfMeasure' THEN
      RAISE EXCEPTION 'recipe ingredient item is not eligible' USING ERRCODE = '23514';
    END IF;

    ingredient_ids := array_append(ingredient_ids, ingredient_id);
    inventory_item_ids := array_append(inventory_item_ids, inventory_item_id);
    normalized_ingredients := normalized_ingredients || jsonb_build_array(jsonb_build_object(
      'id', ingredient_id,
      'inventoryItemId', inventory_item_id,
      'requiredQuantity', required_quantity,
      'unitOfMeasure', configured_ingredient_unit
    ));
  END LOOP;

  IF recipe_exists THEN
    IF current_recipe.product_id IS DISTINCT FROM target_product_id
      OR current_recipe.output_inventory_item_id IS DISTINCT FROM target_output_inventory_item_id THEN
      RAISE EXCEPTION 'recipe identity is immutable' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO current_version
    FROM public.recipe_versions
    WHERE restaurant_id = target_restaurant_id
      AND recipe_id = target_recipe_id
    ORDER BY version_number DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'recipe has no current version' USING ERRCODE = '23514';
    END IF;
    current_version_number := current_version.version_number;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'inventoryItemId', inventory_item_id,
      'requiredQuantity', required_quantity,
      'unitOfMeasure', unit_of_measure
    ) ORDER BY inventory_item_id, id), '[]'::jsonb)
    INTO current_ingredients
    FROM public.recipe_ingredients
    WHERE restaurant_id = target_restaurant_id
      AND recipe_version_id = current_version.id;

    previous_values := jsonb_build_object(
      'restaurantId', current_recipe.restaurant_id,
      'productId', current_recipe.product_id,
      'outputInventoryItemId', current_recipe.output_inventory_item_id,
      'name', current_recipe.name,
      'isActive', current_recipe.is_active,
      'versionId', current_version.id,
      'versionNumber', current_version.version_number,
      'producedQuantity', current_version.produced_quantity,
      'producedUnit', current_version.produced_unit,
      'ingredients', current_ingredients
    );
  ELSE
    current_version_number := 0;
    previous_values := NULL;
  END IF;

  IF current_version_number IS DISTINCT FROM expected_previous_version_number THEN
    RAISE EXCEPTION 'recipe version is stale' USING ERRCODE = '40001';
  END IF;
  next_version_number := current_version_number + 1;

  next_values := jsonb_build_object(
    'restaurantId', target_restaurant_id,
    'productId', target_product_id,
    'outputInventoryItemId', target_output_inventory_item_id,
    'name', recipe_name,
    'isActive', recipe_is_active,
    'versionId', target_recipe_version_id,
    'versionNumber', next_version_number,
    'producedQuantity', recipe_produced_quantity::numeric(14, 3),
    'producedUnit', configured_output_unit,
    'ingredients', normalized_ingredients
  );

  IF NOT recipe_exists THEN
    expected_action := 'recipe.created';
  ELSIF current_recipe.is_active IS DISTINCT FROM recipe_is_active THEN
    expected_action := CASE WHEN recipe_is_active
      THEN 'recipe.activated' ELSE 'recipe.deactivated' END;
  ELSE
    expected_action := 'recipe.updated';
  END IF;

  IF audit_event -> 'previousValues' IS DISTINCT FROM previous_values
    OR audit_event -> 'newValues' IS DISTINCT FROM next_values
    OR audit_event ->> 'action' IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'audit snapshot is stale' USING ERRCODE = '40001';
  END IF;

  IF recipe_exists THEN
    UPDATE public.recipes
    SET name = recipe_name,
        is_active = recipe_is_active,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = target_recipe_id
      AND restaurant_id = target_restaurant_id
      AND deleted_at IS NULL;
  ELSE
    INSERT INTO public.recipes (
      id, restaurant_id, product_id, output_inventory_item_id,
      name, is_active, updated_at, deleted_at
    ) VALUES (
      target_recipe_id, target_restaurant_id, target_product_id,
      target_output_inventory_item_id, recipe_name, recipe_is_active,
      CURRENT_TIMESTAMP, NULL
    );
  END IF;

  INSERT INTO public.recipe_versions (
    id, restaurant_id, recipe_id, version_number,
    produced_quantity, produced_unit, created_by_id
  ) VALUES (
    target_recipe_version_id, target_restaurant_id, target_recipe_id,
    next_version_number, recipe_produced_quantity::numeric(14, 3),
    configured_output_unit, actor_user_id
  );

  FOR ingredient IN SELECT value FROM jsonb_array_elements(normalized_ingredients)
  LOOP
    INSERT INTO public.recipe_ingredients (
      id, restaurant_id, recipe_version_id, inventory_item_id,
      required_quantity, unit_of_measure
    ) VALUES (
      (ingredient ->> 'id')::uuid,
      target_restaurant_id,
      target_recipe_version_id,
      (ingredient ->> 'inventoryItemId')::uuid,
      (ingredient ->> 'requiredQuantity')::numeric(14, 3),
      ingredient ->> 'unitOfMeasure'
    );
  END LOOP;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id,
    (audit_event ->> 'occurredAt')::timestamptz,
    audit_event ->> 'action',
    audit_event ->> 'entityType',
    audit_event ->> 'entityId',
    audit_event -> 'previousValues',
    audit_event -> 'newValues',
    NULLIF(audit_event ->> 'sourceIp', '')::inet
  );

  RETURN QUERY
  SELECT * FROM public.recipe_versions WHERE id = target_recipe_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_recipe(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, text, boolean, numeric, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_recipe(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, text, boolean, numeric, text, text
) TO service_role;
