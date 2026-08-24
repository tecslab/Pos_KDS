CREATE FUNCTION public.save_service_location(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_location_id uuid,
  location_name text,
  location_type text,
  location_display_order integer,
  location_is_active boolean,
  location_allows_multiple boolean,
  audit_event_text text
)
RETURNS SETOF public.service_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_location public.service_locations%ROWTYPE;
  location_exists boolean;
  audit_event jsonb;
  previous_values jsonb;
  next_values jsonb;
  expected_action text;
BEGIN
  IF target_restaurant_id IS NULL OR target_location_id IS NULL
    OR location_name IS NULL OR btrim(location_name) = '' OR length(btrim(location_name)) > 120
    OR location_type IS NULL OR btrim(location_type) = '' OR length(btrim(location_type)) > 80
    OR location_display_order IS NULL OR location_display_order < 0 OR location_display_order > 100000
    OR location_is_active IS NULL OR location_allows_multiple IS NULL THEN
    RAISE EXCEPTION 'service location input is invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    audit_event := audit_event_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(audit_event) IS DISTINCT FROM 'object'
    OR audit_event ->> 'actorId' IS DISTINCT FROM actor_user_id::text
    OR audit_event ->> 'entityType' IS DISTINCT FROM 'service_location'
    OR audit_event ->> 'entityId' IS DISTINCT FROM target_location_id::text
    OR jsonb_typeof(audit_event -> 'newValues') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_location_id::text, 0));
  PERFORM 1 FROM public.restaurants
  WHERE id = target_restaurant_id AND is_active AND deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant was not found' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO current_location FROM public.service_locations
  WHERE id = target_location_id AND restaurant_id = target_restaurant_id FOR UPDATE;
  location_exists := FOUND;
  IF location_exists THEN
    previous_values := jsonb_build_object(
      'restaurantId', current_location.restaurant_id,
      'name', current_location.name,
      'type', current_location.type,
      'displayOrder', current_location.display_order,
      'isActive', current_location.is_active,
      'allowsMultipleActiveOrders', current_location.allows_multiple_active_orders
    );
  ELSE
    previous_values := NULL;
  END IF;
  next_values := jsonb_build_object(
    'restaurantId', target_restaurant_id,
    'name', btrim(location_name),
    'type', btrim(location_type),
    'displayOrder', location_display_order,
    'isActive', location_is_active,
    'allowsMultipleActiveOrders', location_allows_multiple
  );

  IF NOT location_exists THEN
    expected_action := 'service_location.created';
  ELSIF current_location.is_active IS DISTINCT FROM location_is_active THEN
    IF location_is_active THEN
      expected_action := 'service_location.activated';
    ELSE
      expected_action := 'service_location.deactivated';
    END IF;
  ELSE
    expected_action := 'service_location.updated';
  END IF;

  IF audit_event -> 'previousValues' IS DISTINCT FROM previous_values
    OR audit_event -> 'newValues' IS DISTINCT FROM next_values
    OR audit_event ->> 'action' IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'audit snapshot is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.service_locations (
    id, restaurant_id, name, type, display_order, is_active,
    allows_multiple_active_orders, updated_at, deleted_at
  ) VALUES (
    target_location_id, target_restaurant_id, btrim(location_name), btrim(location_type),
    location_display_order, location_is_active, location_allows_multiple,
    CURRENT_TIMESTAMP, NULL
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active,
    allows_multiple_active_orders = EXCLUDED.allows_multiple_active_orders,
    updated_at = CURRENT_TIMESTAMP
  WHERE service_locations.restaurant_id = EXCLUDED.restaurant_id
    AND service_locations.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service location target is invalid' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id, (audit_event ->> 'occurredAt')::timestamptz,
    audit_event ->> 'action', audit_event ->> 'entityType', audit_event ->> 'entityId',
    audit_event -> 'previousValues', audit_event -> 'newValues',
    NULLIF(audit_event ->> 'sourceIp', '')::inet
  );
  RETURN QUERY SELECT * FROM public.service_locations WHERE id = target_location_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_service_location(
  uuid, uuid, uuid, text, text, integer, boolean, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_service_location(
  uuid, uuid, uuid, text, text, integer, boolean, boolean, text
) TO service_role;
