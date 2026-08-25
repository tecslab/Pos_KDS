INSERT INTO public.permissions (code, name, description)
VALUES (
  'administration.inventory.manage',
  'Manage Inventory Items',
  'Create, edit, activate, and deactivate inventory item definitions.'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.roles AS role
JOIN public.permissions AS permission
  ON permission.code = 'administration.inventory.manage'
WHERE role.code = 'administrator'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE FUNCTION public.save_inventory_item(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  inventory_item_name text,
  inventory_item_type public.inventory_item_type,
  inventory_item_unit text,
  inventory_item_minimum_stock numeric,
  inventory_item_is_active boolean,
  audit_event_text text
)
RETURNS SETOF public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_item public.inventory_items%ROWTYPE;
  item_exists boolean;
  audit_event jsonb;
  previous_values jsonb;
  next_values jsonb;
  expected_action text;
BEGIN
  IF actor_user_id IS NULL OR target_restaurant_id IS NULL
    OR target_inventory_item_id IS NULL
    OR inventory_item_name IS NULL OR btrim(inventory_item_name) = ''
    OR length(btrim(inventory_item_name)) > 120
    OR inventory_item_type IS NULL
    OR inventory_item_unit IS NULL OR btrim(inventory_item_unit) = ''
    OR length(btrim(inventory_item_unit)) > 40
    OR inventory_item_minimum_stock IS NULL
    OR inventory_item_minimum_stock < 0
    OR inventory_item_minimum_stock > 99999999999.999
    OR scale(inventory_item_minimum_stock) > 3
    OR inventory_item_is_active IS NULL THEN
    RAISE EXCEPTION 'inventory item input is invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    audit_event := audit_event_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(audit_event) IS DISTINCT FROM 'object'
    OR audit_event ->> 'actorId' IS DISTINCT FROM actor_user_id::text
    OR audit_event ->> 'entityType' IS DISTINCT FROM 'inventory_item'
    OR audit_event ->> 'entityId' IS DISTINCT FROM target_inventory_item_id::text
    OR jsonb_typeof(audit_event -> 'newValues') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_inventory_item_id::text, 0)
  );
  PERFORM 1
  FROM public.restaurants
  WHERE id = target_restaurant_id
    AND is_active
    AND deleted_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant was not found' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO current_item
  FROM public.inventory_items
  WHERE id = target_inventory_item_id
    AND restaurant_id = target_restaurant_id
  FOR UPDATE;
  item_exists := FOUND;

  IF item_exists THEN
    previous_values := jsonb_build_object(
      'restaurantId', current_item.restaurant_id,
      'name', current_item.name,
      'type', current_item.type,
      'unitOfMeasure', current_item.unit_of_measure,
      'minimumStockLevel', current_item.minimum_stock_level,
      'isActive', current_item.is_active
    );
  ELSE
    previous_values := NULL;
  END IF;
  next_values := jsonb_build_object(
    'restaurantId', target_restaurant_id,
    'name', btrim(inventory_item_name),
    'type', inventory_item_type,
    'unitOfMeasure', btrim(inventory_item_unit),
    'minimumStockLevel', inventory_item_minimum_stock,
    'isActive', inventory_item_is_active
  );

  IF NOT item_exists THEN
    expected_action := 'inventory_item.created';
  ELSIF current_item.is_active IS DISTINCT FROM inventory_item_is_active THEN
    IF inventory_item_is_active THEN
      expected_action := 'inventory_item.activated';
    ELSE
      expected_action := 'inventory_item.deactivated';
    END IF;
  ELSE
    expected_action := 'inventory_item.updated';
  END IF;

  IF audit_event -> 'previousValues' IS DISTINCT FROM previous_values
    OR audit_event -> 'newValues' IS DISTINCT FROM next_values
    OR audit_event ->> 'action' IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'audit snapshot is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.inventory_items (
    id,
    restaurant_id,
    name,
    type,
    unit_of_measure,
    minimum_stock_level,
    is_active,
    updated_at,
    deleted_at
  ) VALUES (
    target_inventory_item_id,
    target_restaurant_id,
    btrim(inventory_item_name),
    inventory_item_type,
    btrim(inventory_item_unit),
    inventory_item_minimum_stock,
    inventory_item_is_active,
    CURRENT_TIMESTAMP,
    NULL
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    unit_of_measure = EXCLUDED.unit_of_measure,
    minimum_stock_level = EXCLUDED.minimum_stock_level,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP
  WHERE inventory_items.restaurant_id = EXCLUDED.restaurant_id
    AND inventory_items.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item target is invalid' USING ERRCODE = '23503';
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
  SELECT * FROM public.inventory_items WHERE id = target_inventory_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_inventory_item(
  uuid, uuid, uuid, text, public.inventory_item_type, text, numeric, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_inventory_item(
  uuid, uuid, uuid, text, public.inventory_item_type, text, numeric, boolean, text
) TO service_role;
