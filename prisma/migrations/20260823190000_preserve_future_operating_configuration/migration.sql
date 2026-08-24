CREATE OR REPLACE FUNCTION public.update_restaurant_operating_settings(
  actor_user_id uuid, target_restaurant_id uuid, target_tax_rate_id uuid,
  restaurant_name text, tax_name text, tax_rate numeric,
  opens_at time, closes_at time,
  preparation_warning_minutes integer, preparation_critical_minutes integer,
  delivery_warning_minutes integer, delivery_critical_minutes integer,
  allow_negative_stock boolean, printing_mode text
)
RETURNS TABLE (previous_values jsonb, new_values jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_name text;
  current_tax_name text;
  current_tax_rate numeric;
  current_configuration public.restaurant_configurations%ROWTYPE;
  audit_event jsonb;
BEGIN
  IF restaurant_name IS NULL OR btrim(restaurant_name) = '' OR length(btrim(restaurant_name)) > 160 THEN
    RAISE EXCEPTION 'restaurant name is invalid' USING ERRCODE = '22023';
  END IF;
  IF tax_name IS NULL OR btrim(tax_name) = '' OR length(btrim(tax_name)) > 80 THEN
    RAISE EXCEPTION 'tax name is invalid' USING ERRCODE = '22023';
  END IF;
  IF tax_rate IS NULL OR tax_rate < 0 OR tax_rate > 1 THEN
    RAISE EXCEPTION 'tax rate is invalid' USING ERRCODE = '22023';
  END IF;
  IF opens_at IS NULL OR closes_at IS NULL OR opens_at >= closes_at THEN
    RAISE EXCEPTION 'business hours are invalid' USING ERRCODE = '22023';
  END IF;
  IF preparation_warning_minutes IS NULL
    OR preparation_critical_minutes IS NULL
    OR delivery_warning_minutes IS NULL
    OR delivery_critical_minutes IS NULL
    OR preparation_warning_minutes < 0 OR preparation_warning_minutes > 1440
    OR preparation_critical_minutes > 1440
    OR preparation_critical_minutes < preparation_warning_minutes
    OR delivery_warning_minutes < 0 OR delivery_warning_minutes > 1440
    OR delivery_critical_minutes > 1440
    OR delivery_critical_minutes < delivery_warning_minutes THEN
    RAISE EXCEPTION 'operational thresholds are invalid' USING ERRCODE = '22023';
  END IF;
  IF allow_negative_stock IS NULL THEN
    RAISE EXCEPTION 'operational policy is invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    audit_event := printing_mode::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(audit_event) IS DISTINCT FROM 'object'
    OR audit_event ->> 'actorId' IS DISTINCT FROM actor_user_id::text
    OR audit_event ->> 'action' IS DISTINCT FROM 'restaurant.operating_settings_updated'
    OR audit_event ->> 'entityType' IS DISTINCT FROM 'restaurant'
    OR audit_event ->> 'entityId' IS DISTINCT FROM target_restaurant_id::text
    OR jsonb_typeof(audit_event -> 'previousValues') IS DISTINCT FROM 'object'
    OR jsonb_typeof(audit_event -> 'newValues') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_restaurant_id::text, 0));
  SELECT name INTO STRICT current_name FROM public.restaurants
  WHERE id = target_restaurant_id AND is_active AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO STRICT current_configuration FROM public.restaurant_configurations
  WHERE restaurant_id = target_restaurant_id FOR UPDATE;
  IF jsonb_typeof(current_configuration.business_hours -> 'daily') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'daily business hours are invalid' USING ERRCODE = '22023';
  END IF;
  SELECT name, rate INTO STRICT current_tax_name, current_tax_rate
  FROM public.restaurant_tax_rates
  WHERE id = target_tax_rate_id AND restaurant_id = target_restaurant_id
    AND is_active AND deleted_at IS NULL FOR UPDATE;

  previous_values := jsonb_build_object(
    'name', current_name, 'taxName', current_tax_name, 'taxRate', current_tax_rate,
    'businessHours', jsonb_build_object('daily', jsonb_build_object(
      'opensAt', current_configuration.business_hours #>> '{daily,opensAt}',
      'closesAt', current_configuration.business_hours #>> '{daily,closesAt}')),
    'preparationWarningMinutes', current_configuration.preparation_warning_threshold_minutes,
    'preparationCriticalMinutes', current_configuration.preparation_critical_threshold_minutes,
    'deliveryWarningMinutes', current_configuration.delivery_warning_threshold_minutes,
    'deliveryCriticalMinutes', current_configuration.delivery_critical_threshold_minutes,
    'allowNegativeStock', current_configuration.inventory_policy -> 'allowNegativeStock'
  );
  new_values := jsonb_build_object(
    'name', btrim(restaurant_name), 'taxName', btrim(tax_name), 'taxRate', tax_rate,
    'businessHours', jsonb_build_object('daily', jsonb_build_object(
      'opensAt', to_char(opens_at, 'HH24:MI'), 'closesAt', to_char(closes_at, 'HH24:MI'))),
    'preparationWarningMinutes', preparation_warning_minutes,
    'preparationCriticalMinutes', preparation_critical_minutes,
    'deliveryWarningMinutes', delivery_warning_minutes,
    'deliveryCriticalMinutes', delivery_critical_minutes,
    'allowNegativeStock', allow_negative_stock
  );
  IF audit_event -> 'previousValues' IS DISTINCT FROM previous_values
    OR audit_event -> 'newValues' IS DISTINCT FROM new_values THEN
    RAISE EXCEPTION 'audit snapshot is stale' USING ERRCODE = '40001';
  END IF;

  UPDATE public.restaurants SET name = btrim(restaurant_name), updated_at = CURRENT_TIMESTAMP
  WHERE id = target_restaurant_id;
  UPDATE public.restaurant_tax_rates
  SET name = btrim(tax_name), rate = tax_rate, updated_at = CURRENT_TIMESTAMP
  WHERE id = target_tax_rate_id AND restaurant_id = target_restaurant_id;
  UPDATE public.restaurant_configurations SET
    preparation_warning_threshold_minutes = preparation_warning_minutes,
    preparation_critical_threshold_minutes = preparation_critical_minutes,
    delivery_warning_threshold_minutes = delivery_warning_minutes,
    delivery_critical_threshold_minutes = delivery_critical_minutes,
    inventory_policy = jsonb_set(current_configuration.inventory_policy,
      '{allowNegativeStock}', to_jsonb(allow_negative_stock), true),
    business_hours = jsonb_set(jsonb_set(current_configuration.business_hours,
      '{daily,opensAt}', to_jsonb(to_char(opens_at, 'HH24:MI')), true),
      '{daily,closesAt}', to_jsonb(to_char(closes_at, 'HH24:MI')), true),
    updated_at = CURRENT_TIMESTAMP
  WHERE restaurant_id = target_restaurant_id;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id, (audit_event ->> 'occurredAt')::timestamptz,
    audit_event ->> 'action', audit_event ->> 'entityType', audit_event ->> 'entityId',
    audit_event -> 'previousValues', audit_event -> 'newValues',
    NULLIF(audit_event ->> 'sourceIp', '')::inet
  );
  RETURN NEXT;
EXCEPTION WHEN NO_DATA_FOUND THEN
  RAISE EXCEPTION 'restaurant configuration target was not found' USING ERRCODE = 'P0002';
END;
$$;

REVOKE ALL ON FUNCTION public.update_restaurant_operating_settings(
  uuid, uuid, uuid, text, text, numeric, time, time,
  integer, integer, integer, integer, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_restaurant_operating_settings(
  uuid, uuid, uuid, text, text, numeric, time, time,
  integer, integer, integer, integer, boolean, text
) TO service_role;
