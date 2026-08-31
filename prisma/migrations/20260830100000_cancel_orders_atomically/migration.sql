CREATE FUNCTION public.cancel_order(
  actor_user_id uuid,
  target_order_id uuid,
  cancellation_reason text,
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
  total_amount numeric(12, 2),
  reason text,
  cancelled_by_id uuid,
  cancelled_at timestamptz,
  updated_at timestamptz,
  inventory_movements jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_order record;
  source_sale record;
  source_ip_value inet;
  cancellation_time timestamptz;
  movement_id_to_insert uuid;
  movement_sequence integer := 0;
  movement_summaries jsonb;
BEGIN
  IF actor_user_id IS NULL
    OR target_order_id IS NULL
    OR cancellation_reason IS NULL
    OR audit_occurred_at IS NULL
    OR length(cancellation_reason) > 2000
    OR cancellation_reason IS DISTINCT FROM
      NULLIF(btrim(regexp_replace(cancellation_reason, '\s+', ' ', 'g')), '')
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'order cancellation is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'order cancellation timestamp is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := btrim(audit_source_ip)::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'order cancellation audit source IP is invalid'
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
    AND permission.code = 'orders.cancel'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order cancellation is unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT target.*
  INTO target_order
  FROM public.orders AS target
  WHERE target.id = target_order_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_CANCELLATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF target_order.status NOT IN ('PENDING', 'READY')
    OR EXISTS (
      SELECT 1
      FROM public.order_cancellations AS existing_cancellation
      WHERE existing_cancellation.restaurant_id = target_order.restaurant_id
        AND existing_cancellation.order_id = target_order.id
    ) THEN
    RAISE EXCEPTION 'ORDER_CANCELLATION_NOT_CANCELLABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements AS movement
    WHERE movement.restaurant_id = target_order.restaurant_id
      AND movement.business_origin_type = 'SALE'
      AND movement.business_origin_id = target_order.id
      AND movement.type <> 'SALE'
  ) THEN
    RAISE EXCEPTION 'ORDER_CANCELLATION_INVALID_INVENTORY_PROVENANCE'
      USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMP TABLE pg_temp.t045_movement_summaries (
    sequence integer PRIMARY KEY,
    inventory_movement_id uuid NOT NULL UNIQUE,
    inventory_item_id uuid NOT NULL,
    type public.inventory_movement_type NOT NULL,
    quantity_delta numeric(14, 3) NOT NULL,
    unit_of_measure text NOT NULL,
    reversed_movement_id uuid NOT NULL
  ) ON COMMIT DROP;

  PERFORM inventory_item.id
  FROM public.inventory_items AS inventory_item
  WHERE inventory_item.restaurant_id = target_order.restaurant_id
    AND EXISTS (
      SELECT 1
      FROM public.inventory_movements AS sale
      WHERE sale.restaurant_id = target_order.restaurant_id
        AND sale.inventory_item_id = inventory_item.id
        AND sale.type = 'SALE'
        AND sale.business_origin_type = 'SALE'
        AND sale.business_origin_id = target_order.id
    )
  ORDER BY inventory_item.id
  FOR UPDATE OF inventory_item;

  cancellation_time := GREATEST(
    audit_occurred_at,
    target_order.updated_at + interval '1 microsecond',
    COALESCE(target_order.ready_at + interval '1 microsecond', audit_occurred_at),
    COALESCE((
      SELECT max(sale.recorded_at) + interval '1 microsecond'
      FROM public.inventory_movements AS sale
      WHERE sale.restaurant_id = target_order.restaurant_id
        AND sale.type = 'SALE'
        AND sale.business_origin_type = 'SALE'
        AND sale.business_origin_id = target_order.id
    ), audit_occurred_at)
  );

  FOR source_sale IN
    SELECT
      sale.id,
      sale.inventory_item_id,
      sale.unit_of_measure,
      -sale.quantity_delta - COALESCE(sum(reversal.quantity_delta), 0)
        AS residual_quantity
    FROM public.inventory_movements AS sale
    LEFT JOIN public.inventory_movements AS reversal
      ON reversal.restaurant_id = sale.restaurant_id
     AND reversal.inventory_item_id = sale.inventory_item_id
     AND reversal.reversed_movement_id = sale.id
    WHERE sale.restaurant_id = target_order.restaurant_id
      AND sale.type = 'SALE'
      AND sale.business_origin_type = 'SALE'
      AND sale.business_origin_id = target_order.id
    GROUP BY
      sale.id,
      sale.inventory_item_id,
      sale.unit_of_measure,
      sale.quantity_delta,
      sale.recorded_at
    HAVING -sale.quantity_delta - COALESCE(sum(reversal.quantity_delta), 0) > 0
    ORDER BY sale.inventory_item_id, sale.recorded_at, sale.id
  LOOP
    IF source_sale.residual_quantity > 99999999999.999 THEN
      RAISE EXCEPTION 'order cancellation inventory quantity is out of range'
        USING ERRCODE = '22023';
    END IF;

    movement_id_to_insert := gen_random_uuid();
    INSERT INTO public.inventory_movements (
      id, restaurant_id, inventory_item_id, type, quantity_delta,
      unit_of_measure, recorded_by_id, recorded_at,
      business_origin_type, business_origin_id, comments, reversed_movement_id
    ) VALUES (
      movement_id_to_insert,
      target_order.restaurant_id,
      source_sale.inventory_item_id,
      'ROLLBACK',
      source_sale.residual_quantity::numeric(14, 3),
      source_sale.unit_of_measure,
      actor_user_id,
      cancellation_time,
      'ROLLBACK',
      target_order.id,
      'Order cancellation',
      source_sale.id
    );

    INSERT INTO public.audit_events (
      actor_id, occurred_at, action, entity_type, entity_id,
      previous_values, new_values, source_ip
    ) VALUES (
      actor_user_id,
      cancellation_time,
      'inventory_movement.rollback_recorded',
      'inventory_movement',
      movement_id_to_insert::text,
      NULL,
      jsonb_build_object(
        'inventoryMovementId', movement_id_to_insert,
        'restaurantId', target_order.restaurant_id,
        'inventoryItemId', source_sale.inventory_item_id,
        'type', 'ROLLBACK',
        'quantityDelta', source_sale.residual_quantity::numeric(14, 3),
        'unitOfMeasure', source_sale.unit_of_measure,
        'recordedById', actor_user_id,
        'recordedAt', cancellation_time,
        'businessOriginType', 'ROLLBACK',
        'businessOriginId', target_order.id,
        'comments', 'Order cancellation',
        'reversedMovementId', source_sale.id
      ),
      source_ip_value
    );

    movement_sequence := movement_sequence + 1;
    INSERT INTO pg_temp.t045_movement_summaries VALUES (
      movement_sequence,
      movement_id_to_insert,
      source_sale.inventory_item_id,
      'ROLLBACK',
      source_sale.residual_quantity::numeric(14, 3),
      source_sale.unit_of_measure,
      source_sale.id
    );
  END LOOP;

  INSERT INTO public.order_cancellations (
    order_id, restaurant_id, cancelled_by_id, previous_status, reason, cancelled_at
  ) VALUES (
    target_order.id,
    target_order.restaurant_id,
    actor_user_id,
    target_order.status,
    cancellation_reason,
    cancellation_time
  );

  UPDATE public.orders AS cancelled_order
  SET status = 'CANCELLED', updated_at = cancellation_time
  WHERE cancelled_order.restaurant_id = target_order.restaurant_id
    AND cancelled_order.id = target_order.id;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id,
    cancellation_time,
    'order.cancelled',
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
      'updatedAt', target_order.updated_at
    ),
    jsonb_build_object(
      'orderId', target_order.id,
      'restaurantId', target_order.restaurant_id,
      'serviceLocationId', target_order.service_location_id,
      'orderNumber', target_order.order_number,
      'assignedWaiterId', target_order.assigned_waiter_id,
      'previousStatus', target_order.status,
      'status', 'CANCELLED',
      'notes', target_order.notes,
      'totalAmount', target_order.total_amount,
      'cancelledById', actor_user_id,
      'reason', cancellation_reason,
      'cancelledAt', cancellation_time,
      'updatedAt', cancellation_time
    ),
    source_ip_value
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'inventory_movement_id', summary.inventory_movement_id,
        'inventory_item_id', summary.inventory_item_id,
        'type', summary.type,
        'quantity_delta', summary.quantity_delta,
        'unit_of_measure', summary.unit_of_measure,
        'reversed_movement_id', summary.reversed_movement_id
      ) ORDER BY summary.sequence
    ),
    '[]'::jsonb
  )
  INTO movement_summaries
  FROM pg_temp.t045_movement_summaries AS summary;

  RETURN QUERY SELECT
    target_order.id,
    target_order.restaurant_id,
    target_order.service_location_id,
    target_order.order_number,
    target_order.assigned_waiter_id,
    target_order.status,
    'CANCELLED'::public.order_status,
    target_order.total_amount,
    cancellation_reason,
    actor_user_id,
    cancellation_time,
    cancellation_time,
    movement_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(
  uuid, uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(
  uuid, uuid, text, timestamptz, text
) TO service_role;
