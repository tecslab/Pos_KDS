CREATE FUNCTION public.mark_order_ready(
  actor_user_id uuid,
  target_order_id uuid,
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
  marked_ready_by_id uuid,
  ready_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_order record;
  source_ip_value inet;
  ready_time timestamptz;
BEGIN
  IF actor_user_id IS NULL
    OR target_order_id IS NULL
    OR audit_occurred_at IS NULL
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'Ready transition is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Ready transition timestamp is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := NULLIF(btrim(audit_source_ip), '')::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Ready transition audit source IP is invalid'
        USING ERRCODE = '22023';
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
    AND permission.code = 'kitchen.ready.mark'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ready transition is unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT target.*
  INTO target_order
  FROM public.orders AS target
  WHERE target.id = target_order_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_READY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF target_order.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ORDER_READY_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  ready_time := GREATEST(
    audit_occurred_at,
    target_order.created_at,
    target_order.updated_at + interval '1 microsecond'
  );

  UPDATE public.orders AS ready_order
  SET status = 'READY', ready_at = ready_time, updated_at = ready_time
  WHERE ready_order.restaurant_id = target_order.restaurant_id
    AND ready_order.id = target_order.id;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id,
    ready_time,
    'order.ready',
    'order',
    target_order.id::text,
    jsonb_build_object(
      'orderId', target_order.id,
      'restaurantId', target_order.restaurant_id,
      'serviceLocationId', target_order.service_location_id,
      'orderNumber', target_order.order_number,
      'assignedWaiterId', target_order.assigned_waiter_id,
      'status', target_order.status,
      'notes', target_order.notes,
      'totalAmount', target_order.total_amount,
      'readyAt', target_order.ready_at,
      'updatedAt', target_order.updated_at
    ),
    jsonb_build_object(
      'orderId', target_order.id,
      'restaurantId', target_order.restaurant_id,
      'serviceLocationId', target_order.service_location_id,
      'orderNumber', target_order.order_number,
      'assignedWaiterId', target_order.assigned_waiter_id,
      'previousStatus', target_order.status,
      'status', 'READY',
      'notes', target_order.notes,
      'totalAmount', target_order.total_amount,
      'markedReadyById', actor_user_id,
      'readyAt', ready_time,
      'updatedAt', ready_time
    ),
    source_ip_value
  );

  RETURN QUERY SELECT
    target_order.id,
    target_order.restaurant_id,
    target_order.service_location_id,
    target_order.order_number,
    target_order.assigned_waiter_id,
    'PENDING'::public.order_status,
    'READY'::public.order_status,
    actor_user_id,
    ready_time,
    ready_time;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_ready(
  uuid, uuid, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_ready(
  uuid, uuid, timestamptz, text
) TO service_role;
