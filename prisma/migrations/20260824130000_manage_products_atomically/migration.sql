ALTER TABLE public.product_versions
  ADD COLUMN recipe_id uuid,
  ADD COLUMN resale_inventory_item_id uuid,
  ADD CONSTRAINT product_versions_recipe_fkey
    FOREIGN KEY (restaurant_id, recipe_id)
    REFERENCES public.recipes(restaurant_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT product_versions_resale_item_fkey
    FOREIGN KEY (restaurant_id, resale_inventory_item_id)
    REFERENCES public.inventory_items(restaurant_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT product_versions_source_exclusive
    CHECK (recipe_id IS NULL OR resale_inventory_item_id IS NULL);

CREATE INDEX product_versions_restaurant_recipe_idx
  ON public.product_versions(restaurant_id, recipe_id);
CREATE INDEX product_versions_restaurant_resale_item_idx
  ON public.product_versions(restaurant_id, resale_inventory_item_id);

CREATE FUNCTION public.validate_product_version_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.recipe_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.recipes
    WHERE restaurant_id = NEW.restaurant_id
      AND id = NEW.recipe_id
      AND product_id = NEW.product_id
      AND is_active
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product version recipe is not eligible for this product'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resale_inventory_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_items
    WHERE restaurant_id = NEW.restaurant_id
      AND id = NEW.resale_inventory_item_id
      AND type = 'RESALE_ITEM'
      AND is_active
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product version resale inventory item is not eligible'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_versions_validate_source
BEFORE INSERT ON public.product_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_product_version_source();

CREATE FUNCTION public.save_product(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_product_id uuid,
  target_product_version_id uuid,
  expected_previous_version_number integer,
  target_category_id uuid,
  product_display_order integer,
  product_is_active boolean,
  product_name text,
  product_unit_price numeric,
  product_printer_alias text,
  target_tax_rate_id uuid,
  product_price_includes_tax boolean,
  target_recipe_id uuid,
  target_resale_inventory_item_id uuid,
  product_options_text text,
  product_removals_text text,
  audit_event_text text
)
RETURNS SETOF public.product_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_product public.products%ROWTYPE;
  current_version public.product_versions%ROWTYPE;
  product_exists boolean;
  current_version_number integer;
  next_version_number integer;
  configured_tax_code text;
  configured_tax_name text;
  configured_tax_rate numeric(7, 6);
  options_json jsonb;
  removals_json jsonb;
  modification jsonb;
  modification_ids uuid[];
  modification_names text[];
  modification_id uuid;
  modification_name text;
  modification_adjustment numeric(12, 2);
  modification_order integer;
  current_options jsonb;
  current_removals jsonb;
  audit_event jsonb;
  previous_values jsonb;
  next_values jsonb;
  expected_action text;
BEGIN
  IF actor_user_id IS NULL OR target_restaurant_id IS NULL
    OR target_product_id IS NULL OR target_product_version_id IS NULL
    OR expected_previous_version_number IS NULL
    OR expected_previous_version_number < 0
    OR target_category_id IS NULL
    OR product_display_order IS NULL OR product_display_order < 0
    OR product_display_order > 100000
    OR product_is_active IS NULL
    OR product_name IS NULL OR btrim(product_name) = ''
    OR length(btrim(product_name)) > 120
    OR product_unit_price IS NULL OR product_unit_price < 0
    OR product_unit_price > 9999999999.99
    OR product_printer_alias IS NULL OR btrim(product_printer_alias) = ''
    OR length(btrim(product_printer_alias)) > 120
    OR target_tax_rate_id IS NULL
    OR product_price_includes_tax IS NULL
    OR (target_recipe_id IS NOT NULL AND target_resale_inventory_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'product input is invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    options_json := product_options_text::jsonb;
    removals_json := product_removals_text::jsonb;
    audit_event := audit_event_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'product JSON input is invalid' USING ERRCODE = '22023';
  END;

  IF jsonb_typeof(options_json) IS DISTINCT FROM 'array'
    OR jsonb_typeof(removals_json) IS DISTINCT FROM 'array'
    OR jsonb_array_length(options_json) > 100
    OR jsonb_array_length(removals_json) > 100 THEN
    RAISE EXCEPTION 'product modifications are invalid' USING ERRCODE = '22023';
  END IF;

  FOR modification IN
    SELECT value FROM jsonb_array_elements(options_json)
  LOOP
    IF jsonb_typeof(modification) IS DISTINCT FROM 'object'
      OR jsonb_typeof(modification -> 'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(modification -> 'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(modification -> 'displayOrder') IS DISTINCT FROM 'number'
      OR jsonb_typeof(modification -> 'priceAdjustment') IS NULL
      OR jsonb_typeof(modification -> 'priceAdjustment') NOT IN ('number', 'null')
      OR btrim(modification ->> 'name') = ''
      OR modification ->> 'name' IS DISTINCT FROM btrim(modification ->> 'name')
      OR length(btrim(modification ->> 'name')) > 120
      OR (modification ->> 'displayOrder') !~ '^\d{1,6}$'
      OR (
        jsonb_typeof(modification -> 'priceAdjustment') = 'number'
        AND (modification ->> 'priceAdjustment') !~ '^-?\d{1,10}(\.\d{1,2})?$'
      ) THEN
      RAISE EXCEPTION 'product option is invalid' USING ERRCODE = '22023';
    END IF;
    modification_id := (modification ->> 'id')::uuid;
    modification_name := btrim(modification ->> 'name');
    modification_order := (modification ->> 'displayOrder')::integer;
    IF modification_order > 100000
      OR modification_id = ANY(COALESCE(modification_ids, ARRAY[]::uuid[]))
      OR lower(modification_name) = ANY(COALESCE(modification_names, ARRAY[]::text[])) THEN
      RAISE EXCEPTION 'product option is duplicated or out of range' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(modification -> 'priceAdjustment') = 'number' THEN
      modification_adjustment := (modification ->> 'priceAdjustment')::numeric(12, 2);
    ELSE
      modification_adjustment := NULL;
    END IF;
    modification_ids := array_append(modification_ids, modification_id);
    modification_names := array_append(modification_names, lower(modification_name));
  END LOOP;

  modification_ids := NULL;
  modification_names := NULL;
  FOR modification IN
    SELECT value FROM jsonb_array_elements(removals_json)
  LOOP
    IF jsonb_typeof(modification) IS DISTINCT FROM 'object'
      OR jsonb_typeof(modification -> 'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(modification -> 'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(modification -> 'displayOrder') IS DISTINCT FROM 'number'
      OR jsonb_typeof(modification -> 'priceAdjustment') IS NULL
      OR jsonb_typeof(modification -> 'priceAdjustment') NOT IN ('number', 'null')
      OR btrim(modification ->> 'name') = ''
      OR modification ->> 'name' IS DISTINCT FROM btrim(modification ->> 'name')
      OR length(btrim(modification ->> 'name')) > 120
      OR (modification ->> 'displayOrder') !~ '^\d{1,6}$'
      OR (
        jsonb_typeof(modification -> 'priceAdjustment') = 'number'
        AND (modification ->> 'priceAdjustment') !~ '^-?\d{1,10}(\.\d{1,2})?$'
      ) THEN
      RAISE EXCEPTION 'product removable ingredient is invalid' USING ERRCODE = '22023';
    END IF;
    modification_id := (modification ->> 'id')::uuid;
    modification_name := btrim(modification ->> 'name');
    modification_order := (modification ->> 'displayOrder')::integer;
    IF modification_order > 100000
      OR modification_id = ANY(COALESCE(modification_ids, ARRAY[]::uuid[]))
      OR lower(modification_name) = ANY(COALESCE(modification_names, ARRAY[]::text[])) THEN
      RAISE EXCEPTION 'product removal is duplicated or out of range' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(modification -> 'priceAdjustment') = 'number' THEN
      modification_adjustment := (modification ->> 'priceAdjustment')::numeric(12, 2);
    ELSE
      modification_adjustment := NULL;
    END IF;
    modification_ids := array_append(modification_ids, modification_id);
    modification_names := array_append(modification_names, lower(modification_name));
  END LOOP;

  IF jsonb_typeof(audit_event) IS DISTINCT FROM 'object'
    OR audit_event ->> 'actorId' IS DISTINCT FROM actor_user_id::text
    OR audit_event ->> 'entityType' IS DISTINCT FROM 'product'
    OR audit_event ->> 'entityId' IS DISTINCT FROM target_product_id::text
    OR jsonb_typeof(audit_event -> 'newValues') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_product_id::text, 0));
  PERFORM 1
  FROM public.restaurants AS restaurant
  JOIN public.product_catalogs AS catalog
    ON catalog.restaurant_id = restaurant.id
  WHERE restaurant.id = target_restaurant_id
    AND restaurant.is_active
    AND restaurant.deleted_at IS NULL
    AND catalog.is_active
    AND catalog.deleted_at IS NULL
  FOR KEY SHARE OF restaurant, catalog;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant product catalog was not found' USING ERRCODE = '23503';
  END IF;

  PERFORM 1
  FROM public.product_categories
  WHERE restaurant_id = target_restaurant_id
    AND id = target_category_id
    AND deleted_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product category was not found' USING ERRCODE = '23503';
  END IF;

  SELECT code, name, rate
  INTO configured_tax_code, configured_tax_name, configured_tax_rate
  FROM public.restaurant_tax_rates
  WHERE restaurant_id = target_restaurant_id
    AND id = target_tax_rate_id
    AND deleted_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product tax rate was not found' USING ERRCODE = '23503';
  END IF;

  IF target_recipe_id IS NOT NULL THEN
    PERFORM 1
    FROM public.recipes
    WHERE restaurant_id = target_restaurant_id
      AND id = target_recipe_id
      AND product_id = target_product_id
      AND is_active
      AND deleted_at IS NULL
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product recipe is not eligible' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF target_resale_inventory_item_id IS NOT NULL THEN
    PERFORM 1
    FROM public.inventory_items
    WHERE restaurant_id = target_restaurant_id
      AND id = target_resale_inventory_item_id
      AND type = 'RESALE_ITEM'
      AND is_active
      AND deleted_at IS NULL
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'resale inventory item is not eligible' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT * INTO current_product
  FROM public.products
  WHERE id = target_product_id
    AND restaurant_id = target_restaurant_id
    AND deleted_at IS NULL
  FOR UPDATE;
  product_exists := FOUND;

  IF product_exists THEN
    SELECT * INTO current_version
    FROM public.product_versions
    WHERE restaurant_id = target_restaurant_id
      AND product_id = target_product_id
    ORDER BY version_number DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product has no current version' USING ERRCODE = '23514';
    END IF;
    current_version_number := current_version.version_number;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'priceAdjustment', price_adjustment,
      'displayOrder', display_order
    ) ORDER BY display_order, name, id), '[]'::jsonb)
    INTO current_options
    FROM public.product_options
    WHERE restaurant_id = target_restaurant_id
      AND product_version_id = current_version.id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'priceAdjustment', price_adjustment,
      'displayOrder', display_order
    ) ORDER BY display_order, name, id), '[]'::jsonb)
    INTO current_removals
    FROM public.product_removable_ingredients
    WHERE restaurant_id = target_restaurant_id
      AND product_version_id = current_version.id;

    previous_values := jsonb_build_object(
      'restaurantId', current_product.restaurant_id,
      'categoryId', current_product.category_id,
      'displayOrder', current_product.display_order,
      'isActive', current_product.is_active,
      'versionId', current_version.id,
      'versionNumber', current_version.version_number,
      'name', current_version.name,
      'unitPrice', current_version.unit_price,
      'printerAlias', current_version.printer_alias,
      'taxRateId', current_version.tax_rate_id,
      'taxCode', current_version.tax_code,
      'taxName', current_version.tax_name,
      'taxRate', current_version.tax_rate,
      'priceIncludesTax', current_version.price_includes_tax,
      'recipeId', current_version.recipe_id,
      'resaleInventoryItemId', current_version.resale_inventory_item_id,
      'options', current_options,
      'removableIngredients', current_removals
    );
  ELSE
    current_version_number := 0;
    previous_values := NULL;
  END IF;

  IF current_version_number IS DISTINCT FROM expected_previous_version_number THEN
    RAISE EXCEPTION 'product version is stale' USING ERRCODE = '40001';
  END IF;
  next_version_number := current_version_number + 1;

  next_values := jsonb_build_object(
    'restaurantId', target_restaurant_id,
    'categoryId', target_category_id,
    'displayOrder', product_display_order,
    'isActive', product_is_active,
    'versionId', target_product_version_id,
    'versionNumber', next_version_number,
    'name', btrim(product_name),
    'unitPrice', product_unit_price::numeric(12, 2),
    'printerAlias', btrim(product_printer_alias),
    'taxRateId', target_tax_rate_id,
    'taxCode', configured_tax_code,
    'taxName', configured_tax_name,
    'taxRate', configured_tax_rate,
    'priceIncludesTax', product_price_includes_tax,
    'recipeId', target_recipe_id,
    'resaleInventoryItemId', target_resale_inventory_item_id,
    'options', options_json,
    'removableIngredients', removals_json
  );

  IF NOT product_exists THEN
    expected_action := 'product.created';
  ELSIF current_product.is_active IS DISTINCT FROM product_is_active THEN
    expected_action := CASE WHEN product_is_active
      THEN 'product.activated' ELSE 'product.deactivated' END;
  ELSE
    expected_action := 'product.updated';
  END IF;

  IF audit_event -> 'previousValues' IS DISTINCT FROM previous_values
    OR audit_event -> 'newValues' IS DISTINCT FROM next_values
    OR audit_event ->> 'action' IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'audit snapshot is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.products (
    id, restaurant_id, category_id, display_order, is_active, updated_at, deleted_at
  ) VALUES (
    target_product_id, target_restaurant_id, target_category_id,
    product_display_order, product_is_active, CURRENT_TIMESTAMP, NULL
  ) ON CONFLICT (id) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP
  WHERE products.restaurant_id = EXCLUDED.restaurant_id
    AND products.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product target is invalid' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.product_versions (
    id, restaurant_id, product_id, version_number, name, unit_price,
    printer_alias, tax_rate_id, tax_code, tax_name, tax_rate,
    price_includes_tax, recipe_id, resale_inventory_item_id
  ) VALUES (
    target_product_version_id, target_restaurant_id, target_product_id,
    next_version_number, btrim(product_name), product_unit_price::numeric(12, 2),
    btrim(product_printer_alias), target_tax_rate_id, configured_tax_code,
    configured_tax_name, configured_tax_rate, product_price_includes_tax,
    target_recipe_id, target_resale_inventory_item_id
  );

  FOR modification IN
    SELECT value FROM jsonb_array_elements(options_json)
  LOOP
    INSERT INTO public.product_options (
      id, restaurant_id, product_version_id, name, price_adjustment, display_order
    ) VALUES (
      (modification ->> 'id')::uuid,
      target_restaurant_id,
      target_product_version_id,
      btrim(modification ->> 'name'),
      CASE WHEN jsonb_typeof(modification -> 'priceAdjustment') = 'number'
        THEN (modification ->> 'priceAdjustment')::numeric(12, 2) ELSE NULL END,
      (modification ->> 'displayOrder')::integer
    );
  END LOOP;

  FOR modification IN
    SELECT value FROM jsonb_array_elements(removals_json)
  LOOP
    INSERT INTO public.product_removable_ingredients (
      id, restaurant_id, product_version_id, name, price_adjustment, display_order
    ) VALUES (
      (modification ->> 'id')::uuid,
      target_restaurant_id,
      target_product_version_id,
      btrim(modification ->> 'name'),
      CASE WHEN jsonb_typeof(modification -> 'priceAdjustment') = 'number'
        THEN (modification ->> 'priceAdjustment')::numeric(12, 2) ELSE NULL END,
      (modification ->> 'displayOrder')::integer
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
  SELECT * FROM public.product_versions WHERE id = target_product_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_product(
  uuid, uuid, uuid, uuid, integer, uuid, integer, boolean, text, numeric,
  text, uuid, boolean, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_product(
  uuid, uuid, uuid, uuid, integer, uuid, integer, boolean, text, numeric,
  text, uuid, boolean, uuid, uuid, text, text, text
) TO service_role;
