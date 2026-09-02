CREATE FUNCTION public.mark_order_delivered(
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
  delivered_by_id uuid,
  ready_at timestamptz,
  on_the_way_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_order record;
  source_ip_value inet;
  delivery_time timestamptz;
BEGIN
  IF actor_user_id IS NULL
    OR target_order_id IS NULL
    OR audit_occurred_at IS NULL
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'Delivered transition is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Delivered transition timestamp is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := NULLIF(btrim(audit_source_ip), '')::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Delivered transition audit source IP is invalid'
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
    AND permission.code = 'delivery.delivered.mark'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivered transition is unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT target.*
  INTO target_order
  FROM public.orders AS target
  WHERE target.id = target_order_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_DELIVERED_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF target_order.status <> 'ON_THE_WAY' THEN
    RAISE EXCEPTION 'ORDER_DELIVERED_NOT_ON_THE_WAY' USING ERRCODE = 'P0001';
  END IF;

  delivery_time := GREATEST(
    audit_occurred_at,
    target_order.on_the_way_at,
    target_order.updated_at + interval '1 microsecond'
  );

  UPDATE public.orders AS delivered_order
  SET status = 'DELIVERED',
      delivered_at = delivery_time,
      updated_at = delivery_time
  WHERE delivered_order.restaurant_id = target_order.restaurant_id
    AND delivered_order.id = target_order.id;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id,
    delivery_time,
    'order.delivered',
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
      'onTheWayAt', target_order.on_the_way_at,
      'deliveredAt', target_order.delivered_at,
      'updatedAt', target_order.updated_at
    ),
    jsonb_build_object(
      'orderId', target_order.id,
      'restaurantId', target_order.restaurant_id,
      'serviceLocationId', target_order.service_location_id,
      'orderNumber', target_order.order_number,
      'assignedWaiterId', target_order.assigned_waiter_id,
      'previousStatus', target_order.status,
      'status', 'DELIVERED',
      'notes', target_order.notes,
      'totalAmount', target_order.total_amount,
      'deliveredById', actor_user_id,
      'readyAt', target_order.ready_at,
      'onTheWayAt', target_order.on_the_way_at,
      'deliveredAt', delivery_time,
      'updatedAt', delivery_time
    ),
    source_ip_value
  );

  RETURN QUERY SELECT
    target_order.id,
    target_order.restaurant_id,
    target_order.service_location_id,
    target_order.order_number,
    target_order.assigned_waiter_id,
    'ON_THE_WAY'::public.order_status,
    'DELIVERED'::public.order_status,
    actor_user_id,
    target_order.ready_at,
    target_order.on_the_way_at,
    delivery_time,
    delivery_time;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_delivered(
  uuid, uuid, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_delivered(
  uuid, uuid, timestamptz, text
) TO service_role;
