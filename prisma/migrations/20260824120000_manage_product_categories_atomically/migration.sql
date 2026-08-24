CREATE FUNCTION public.save_product_category(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_category_id uuid,
  category_name text,
  category_display_order integer,
  category_is_active boolean,
  audit_event_text text
)
RETURNS SETOF public.product_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_category public.product_categories%ROWTYPE;
  category_exists boolean;
  audit_event jsonb;
  previous_values jsonb;
  next_values jsonb;
  expected_action text;
BEGIN
  IF target_restaurant_id IS NULL OR target_category_id IS NULL
    OR category_name IS NULL OR btrim(category_name) = ''
    OR length(btrim(category_name)) > 120
    OR category_display_order IS NULL OR category_display_order < 0
    OR category_display_order > 100000
    OR category_is_active IS NULL THEN
    RAISE EXCEPTION 'product category input is invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    audit_event := audit_event_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(audit_event) IS DISTINCT FROM 'object'
    OR audit_event ->> 'actorId' IS DISTINCT FROM actor_user_id::text
    OR audit_event ->> 'entityType' IS DISTINCT FROM 'product_category'
    OR audit_event ->> 'entityId' IS DISTINCT FROM target_category_id::text
    OR jsonb_typeof(audit_event -> 'newValues') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_category_id::text, 0));
  PERFORM 1
  FROM public.restaurants AS restaurant
  JOIN public.product_catalogs AS catalog
    ON catalog.restaurant_id = restaurant.id
  WHERE restaurant.id = target_restaurant_id
    AND restaurant.is_active
    AND restaurant.deleted_at IS NULL
    AND catalog.deleted_at IS NULL
  FOR KEY SHARE OF restaurant, catalog;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant product catalog was not found' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO current_category
  FROM public.product_categories
  WHERE id = target_category_id
    AND restaurant_id = target_restaurant_id
  FOR UPDATE;
  category_exists := FOUND;

  IF category_exists THEN
    previous_values := jsonb_build_object(
      'restaurantId', current_category.restaurant_id,
      'name', current_category.name,
      'displayOrder', current_category.display_order,
      'isActive', current_category.is_active
    );
  ELSE
    previous_values := NULL;
  END IF;
  next_values := jsonb_build_object(
    'restaurantId', target_restaurant_id,
    'name', btrim(category_name),
    'displayOrder', category_display_order,
    'isActive', category_is_active
  );

  IF NOT category_exists THEN
    expected_action := 'product_category.created';
  ELSIF current_category.is_active IS DISTINCT FROM category_is_active THEN
    IF category_is_active THEN
      expected_action := 'product_category.activated';
    ELSE
      expected_action := 'product_category.deactivated';
    END IF;
  ELSIF current_category.display_order IS DISTINCT FROM category_display_order THEN
    expected_action := 'product_category.reordered';
  ELSE
    expected_action := 'product_category.updated';
  END IF;

  IF audit_event -> 'previousValues' IS DISTINCT FROM previous_values
    OR audit_event -> 'newValues' IS DISTINCT FROM next_values
    OR audit_event ->> 'action' IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'audit snapshot is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.product_categories (
    id,
    restaurant_id,
    name,
    display_order,
    is_active,
    updated_at,
    deleted_at
  ) VALUES (
    target_category_id,
    target_restaurant_id,
    btrim(category_name),
    category_display_order,
    category_is_active,
    CURRENT_TIMESTAMP,
    NULL
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP
  WHERE product_categories.restaurant_id = EXCLUDED.restaurant_id
    AND product_categories.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product category target is invalid' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.audit_events (
    actor_id,
    occurred_at,
    action,
    entity_type,
    entity_id,
    previous_values,
    new_values,
    source_ip
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
  SELECT * FROM public.product_categories WHERE id = target_category_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_product_category(
  uuid, uuid, uuid, text, integer, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_product_category(
  uuid, uuid, uuid, text, integer, boolean, text
) TO service_role;
