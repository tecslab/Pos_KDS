DROP INDEX public.inventory_movements_one_reversal_idx;

CREATE OR REPLACE FUNCTION public.validate_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item_unit text;
  allow_negative_stock boolean;
  current_balance numeric(14, 3);
  reversed_quantity numeric(14, 3);
  reversed_type public.inventory_movement_type;
  reversed_recorded_at timestamptz;
  already_reversed_quantity numeric(14, 3);
BEGIN
  SELECT item.unit_of_measure,
         (configuration.inventory_policy ->> 'allowNegativeStock')::boolean
  INTO item_unit, allow_negative_stock
  FROM public.inventory_items AS item
  JOIN public.restaurant_configurations AS configuration
    ON configuration.restaurant_id = item.restaurant_id
  WHERE item.restaurant_id = NEW.restaurant_id
    AND item.id = NEW.inventory_item_id
  FOR UPDATE OF item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item or restaurant inventory policy does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.unit_of_measure <> item_unit THEN
    RAISE EXCEPTION 'movement unit must match the inventory item unit'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.business_origin_type = 'PRODUCTION' AND NOT EXISTS (
    SELECT 1
    FROM public.production_batches AS production_batch
    WHERE production_batch.restaurant_id = NEW.restaurant_id
      AND production_batch.id = NEW.business_origin_id
  ) THEN
    RAISE EXCEPTION 'production movement origin must reference a same-restaurant production batch'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.business_origin_type = 'SALE' AND NOT EXISTS (
    SELECT 1
    FROM public.orders AS origin_order
    WHERE origin_order.restaurant_id = NEW.restaurant_id
      AND origin_order.id = NEW.business_origin_id
  ) THEN
    RAISE EXCEPTION 'sale movement origin must reference a same-restaurant order'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.reversed_movement_id IS NOT NULL THEN
    IF NEW.reversed_movement_id = NEW.id THEN
      RAISE EXCEPTION 'rollback movement cannot reference itself'
        USING ERRCODE = '23514';
    END IF;

    SELECT movement.quantity_delta, movement.type, movement.recorded_at
    INTO reversed_quantity, reversed_type, reversed_recorded_at
    FROM public.inventory_movements AS movement
    WHERE movement.restaurant_id = NEW.restaurant_id
      AND movement.inventory_item_id = NEW.inventory_item_id
      AND movement.id = NEW.reversed_movement_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'reversed inventory movement does not exist'
        USING ERRCODE = '23503';
    END IF;

    IF reversed_type = 'ROLLBACK' THEN
      RAISE EXCEPTION 'rollback movements cannot reverse another rollback'
        USING ERRCODE = '23514';
    END IF;

    IF reversed_recorded_at >= NEW.recorded_at THEN
      RAISE EXCEPTION 'rollback must reference an earlier inventory movement'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.quantity_delta * reversed_quantity >= 0 THEN
      RAISE EXCEPTION 'rollback movement must have the opposite sign of its referenced movement'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(sum(reversal.quantity_delta), 0)
    INTO already_reversed_quantity
    FROM public.inventory_movements AS reversal
    WHERE reversal.restaurant_id = NEW.restaurant_id
      AND reversal.inventory_item_id = NEW.inventory_item_id
      AND reversal.reversed_movement_id = NEW.reversed_movement_id;

    IF abs(already_reversed_quantity + NEW.quantity_delta) > abs(reversed_quantity) THEN
      RAISE EXCEPTION 'rollback movements cannot cumulatively exceed the referenced movement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT COALESCE(sum(movement.quantity_delta), 0)
  INTO current_balance
  FROM public.inventory_movements AS movement
  WHERE movement.restaurant_id = NEW.restaurant_id
    AND movement.inventory_item_id = NEW.inventory_item_id;

  IF current_balance + NEW.quantity_delta < 0 AND NOT allow_negative_stock THEN
    RAISE EXCEPTION 'inventory movement would produce a negative balance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.modify_pending_order(
  uuid, uuid, timestamptz, text, timestamptz, text
) RENAME TO modify_pending_order_without_inventory;

REVOKE ALL ON FUNCTION public.modify_pending_order_without_inventory(
  uuid, uuid, timestamptz, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.modify_pending_order(
  actor_user_id uuid,
  target_order_id uuid,
  expected_order_updated_at timestamptz,
  operations_text text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  order_id uuid,
  restaurant_id uuid,
  service_location_id uuid,
  order_number text,
  assigned_waiter_id uuid,
  status public.order_status,
  total_amount numeric(12, 2),
  updated_at timestamptz,
  baskets jsonb,
  inventory_movements jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  modified_order record;
  resale_delta record;
  source_sale record;
  movement_id_to_insert uuid;
  rollback_quantity numeric(14, 3);
  remaining_to_restore numeric(14, 3);
  inventory_error_message text;
  source_ip_value inet;
  movement_sequence integer := 0;
  movement_summaries jsonb;
BEGIN
  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := btrim(audit_source_ip)::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'order audit source IP is invalid' USING ERRCODE = '22023';
    END;
  END IF;

  CREATE TEMP TABLE pg_temp.t079_resale_before (
    inventory_item_id uuid PRIMARY KEY,
    quantity numeric NOT NULL,
    snapshot_quantities jsonb NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.t079_resale_after (
    inventory_item_id uuid PRIMARY KEY,
    quantity numeric NOT NULL,
    snapshot_quantities jsonb NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.t079_resale_deltas (
    inventory_item_id uuid PRIMARY KEY,
    previous_quantity numeric NOT NULL,
    new_quantity numeric NOT NULL,
    quantity_delta numeric NOT NULL,
    previous_snapshot_quantities jsonb NOT NULL,
    new_snapshot_quantities jsonb NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.t079_movement_summaries (
    sequence integer PRIMARY KEY,
    inventory_movement_id uuid NOT NULL UNIQUE,
    inventory_item_id uuid NOT NULL,
    type public.inventory_movement_type NOT NULL,
    quantity_delta numeric(14, 3) NOT NULL,
    unit_of_measure text NOT NULL,
    reversed_movement_id uuid
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.t079_resale_before (
    inventory_item_id, quantity, snapshot_quantities
  )
  SELECT
    product_version.resale_inventory_item_id,
    sum(snapshot.quantity),
    jsonb_object_agg(snapshot.id::text, snapshot.quantity ORDER BY snapshot.id::text)
  FROM public.customer_baskets AS basket
  JOIN public.order_lines AS line
    ON line.restaurant_id = basket.restaurant_id
   AND line.basket_id = basket.id
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.restaurant_id = line.restaurant_id
   AND snapshot.order_line_id = line.id
   AND snapshot.id = line.current_snapshot_id
  JOIN public.product_versions AS product_version
    ON product_version.restaurant_id = snapshot.restaurant_id
   AND product_version.id = snapshot.product_version_id
  LEFT JOIN public.order_line_removals AS removal
    ON removal.restaurant_id = line.restaurant_id
   AND removal.order_line_id = line.id
  WHERE basket.order_id = target_order_id
    AND removal.order_line_id IS NULL
    AND product_version.resale_inventory_item_id IS NOT NULL
  GROUP BY product_version.resale_inventory_item_id;

  SELECT result.*
  INTO modified_order
  FROM public.modify_pending_order_without_inventory(
    actor_user_id,
    target_order_id,
    expected_order_updated_at,
    operations_text,
    audit_occurred_at,
    audit_source_ip
  ) AS result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order modification returned no aggregate' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO pg_temp.t079_resale_after (
    inventory_item_id, quantity, snapshot_quantities
  )
  SELECT
    product_version.resale_inventory_item_id,
    sum(snapshot.quantity),
    jsonb_object_agg(snapshot.id::text, snapshot.quantity ORDER BY snapshot.id::text)
  FROM public.customer_baskets AS basket
  JOIN public.order_lines AS line
    ON line.restaurant_id = basket.restaurant_id
   AND line.basket_id = basket.id
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.restaurant_id = line.restaurant_id
   AND snapshot.order_line_id = line.id
   AND snapshot.id = line.current_snapshot_id
  JOIN public.product_versions AS product_version
    ON product_version.restaurant_id = snapshot.restaurant_id
   AND product_version.id = snapshot.product_version_id
  LEFT JOIN public.order_line_removals AS removal
    ON removal.restaurant_id = line.restaurant_id
   AND removal.order_line_id = line.id
  WHERE basket.order_id = target_order_id
    AND removal.order_line_id IS NULL
    AND product_version.resale_inventory_item_id IS NOT NULL
  GROUP BY product_version.resale_inventory_item_id;

  INSERT INTO pg_temp.t079_resale_deltas (
    inventory_item_id,
    previous_quantity,
    new_quantity,
    quantity_delta,
    previous_snapshot_quantities,
    new_snapshot_quantities
  )
  SELECT
    COALESCE(before_state.inventory_item_id, after_state.inventory_item_id),
    COALESCE(before_state.quantity, 0),
    COALESCE(after_state.quantity, 0),
    COALESCE(after_state.quantity, 0) - COALESCE(before_state.quantity, 0),
    COALESCE(before_state.snapshot_quantities, '{}'::jsonb),
    COALESCE(after_state.snapshot_quantities, '{}'::jsonb)
  FROM pg_temp.t079_resale_before AS before_state
  FULL JOIN pg_temp.t079_resale_after AS after_state
    ON after_state.inventory_item_id = before_state.inventory_item_id
  WHERE COALESCE(after_state.quantity, 0) <> COALESCE(before_state.quantity, 0);

  IF EXISTS (
    SELECT 1
    FROM pg_temp.t079_resale_deltas AS delta
    WHERE abs(delta.quantity_delta) > 99999999999.999
  ) THEN
    RAISE EXCEPTION 'order inventory quantity is out of range' USING ERRCODE = '22023';
  END IF;

  PERFORM inventory_item.id
  FROM public.inventory_items AS inventory_item
  JOIN pg_temp.t079_resale_deltas AS delta
    ON delta.inventory_item_id = inventory_item.id
  WHERE inventory_item.restaurant_id = modified_order.restaurant_id
  ORDER BY inventory_item.id
  FOR UPDATE OF inventory_item;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.t079_resale_deltas AS delta
    LEFT JOIN public.inventory_items AS inventory_item
      ON inventory_item.restaurant_id = modified_order.restaurant_id
     AND inventory_item.id = delta.inventory_item_id
    WHERE inventory_item.id IS NULL
      OR inventory_item.type IS DISTINCT FROM 'RESALE_ITEM'
      OR (
        delta.quantity_delta > 0
        AND (NOT inventory_item.is_active OR inventory_item.deleted_at IS NOT NULL)
      )
  ) THEN
    RAISE EXCEPTION 'ORDER_MODIFICATION_STALE_CONFIGURATION'
      USING ERRCODE = 'P0001';
  END IF;

  FOR resale_delta IN
    SELECT
      delta.*,
      inventory_item.unit_of_measure
    FROM pg_temp.t079_resale_deltas AS delta
    JOIN public.inventory_items AS inventory_item
      ON inventory_item.restaurant_id = modified_order.restaurant_id
     AND inventory_item.id = delta.inventory_item_id
    ORDER BY delta.inventory_item_id
  LOOP
    IF resale_delta.quantity_delta > 0 THEN
      movement_id_to_insert := gen_random_uuid();
      BEGIN
        INSERT INTO public.inventory_movements (
          id, restaurant_id, inventory_item_id, type, quantity_delta,
          unit_of_measure, recorded_by_id, recorded_at,
          business_origin_type, business_origin_id, comments, reversed_movement_id
        ) VALUES (
          movement_id_to_insert,
          modified_order.restaurant_id,
          resale_delta.inventory_item_id,
          'SALE',
          -resale_delta.quantity_delta::numeric(14, 3),
          resale_delta.unit_of_measure,
          actor_user_id,
          modified_order.updated_at,
          'SALE',
          target_order_id,
          NULL,
          NULL
        );
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS inventory_error_message = MESSAGE_TEXT;
        IF inventory_error_message = 'inventory movement would produce a negative balance' THEN
          RAISE EXCEPTION 'ORDER_MODIFICATION_INSUFFICIENT_INVENTORY'
            USING ERRCODE = 'P0001';
        END IF;
        RAISE;
      END;

      INSERT INTO public.audit_events (
        actor_id, occurred_at, action, entity_type, entity_id,
        previous_values, new_values, source_ip
      ) VALUES (
        actor_user_id,
        modified_order.updated_at,
        'inventory_movement.sale_recorded',
        'inventory_movement',
        movement_id_to_insert::text,
        NULL,
        jsonb_build_object(
          'inventoryMovementId', movement_id_to_insert,
          'restaurantId', modified_order.restaurant_id,
          'inventoryItemId', resale_delta.inventory_item_id,
          'type', 'SALE',
          'quantityDelta', -resale_delta.quantity_delta::numeric(14, 3),
          'unitOfMeasure', resale_delta.unit_of_measure,
          'recordedById', actor_user_id,
          'recordedAt', modified_order.updated_at,
          'businessOriginType', 'SALE',
          'businessOriginId', target_order_id,
          'comments', NULL,
          'reversedMovementId', NULL,
          'previousQuantity', resale_delta.previous_quantity,
          'newQuantity', resale_delta.new_quantity,
          'previousSnapshotQuantities', resale_delta.previous_snapshot_quantities,
          'newSnapshotQuantities', resale_delta.new_snapshot_quantities
        ),
        source_ip_value
      );

      movement_sequence := movement_sequence + 1;
      INSERT INTO pg_temp.t079_movement_summaries VALUES (
        movement_sequence,
        movement_id_to_insert,
        resale_delta.inventory_item_id,
        'SALE',
        -resale_delta.quantity_delta::numeric(14, 3),
        resale_delta.unit_of_measure,
        NULL
      );
      CONTINUE;
    END IF;

    remaining_to_restore := -resale_delta.quantity_delta::numeric(14, 3);
    FOR source_sale IN
      SELECT
        sale.id,
        -sale.quantity_delta - COALESCE(sum(reversal.quantity_delta), 0) AS available_quantity
      FROM public.inventory_movements AS sale
      LEFT JOIN public.inventory_movements AS reversal
        ON reversal.restaurant_id = sale.restaurant_id
       AND reversal.inventory_item_id = sale.inventory_item_id
       AND reversal.reversed_movement_id = sale.id
      WHERE sale.restaurant_id = modified_order.restaurant_id
        AND sale.inventory_item_id = resale_delta.inventory_item_id
        AND sale.type = 'SALE'
        AND sale.business_origin_type = 'SALE'
        AND sale.business_origin_id = target_order_id
      GROUP BY sale.id, sale.quantity_delta, sale.recorded_at
      HAVING -sale.quantity_delta - COALESCE(sum(reversal.quantity_delta), 0) > 0
      ORDER BY sale.recorded_at, sale.id
    LOOP
      EXIT WHEN remaining_to_restore = 0;
      rollback_quantity := LEAST(remaining_to_restore, source_sale.available_quantity);
      movement_id_to_insert := gen_random_uuid();

      INSERT INTO public.inventory_movements (
        id, restaurant_id, inventory_item_id, type, quantity_delta,
        unit_of_measure, recorded_by_id, recorded_at,
        business_origin_type, business_origin_id, comments, reversed_movement_id
      ) VALUES (
        movement_id_to_insert,
        modified_order.restaurant_id,
        resale_delta.inventory_item_id,
        'ROLLBACK',
        rollback_quantity,
        resale_delta.unit_of_measure,
        actor_user_id,
        modified_order.updated_at,
        'ROLLBACK',
        target_order_id,
        NULL,
        source_sale.id
      );

      INSERT INTO public.audit_events (
        actor_id, occurred_at, action, entity_type, entity_id,
        previous_values, new_values, source_ip
      ) VALUES (
        actor_user_id,
        modified_order.updated_at,
        'inventory_movement.rollback_recorded',
        'inventory_movement',
        movement_id_to_insert::text,
        NULL,
        jsonb_build_object(
          'inventoryMovementId', movement_id_to_insert,
          'restaurantId', modified_order.restaurant_id,
          'inventoryItemId', resale_delta.inventory_item_id,
          'type', 'ROLLBACK',
          'quantityDelta', rollback_quantity,
          'unitOfMeasure', resale_delta.unit_of_measure,
          'recordedById', actor_user_id,
          'recordedAt', modified_order.updated_at,
          'businessOriginType', 'ROLLBACK',
          'businessOriginId', target_order_id,
          'comments', NULL,
          'reversedMovementId', source_sale.id,
          'previousQuantity', resale_delta.previous_quantity,
          'newQuantity', resale_delta.new_quantity,
          'previousSnapshotQuantities', resale_delta.previous_snapshot_quantities,
          'newSnapshotQuantities', resale_delta.new_snapshot_quantities
        ),
        source_ip_value
      );

      movement_sequence := movement_sequence + 1;
      INSERT INTO pg_temp.t079_movement_summaries VALUES (
        movement_sequence,
        movement_id_to_insert,
        resale_delta.inventory_item_id,
        'ROLLBACK',
        rollback_quantity,
        resale_delta.unit_of_measure,
        source_sale.id
      );
      remaining_to_restore := remaining_to_restore - rollback_quantity;
    END LOOP;

    IF remaining_to_restore <> 0 THEN
      RAISE EXCEPTION 'ORDER_MODIFICATION_INVALID_INVENTORY_PROVENANCE'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

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
  FROM pg_temp.t079_movement_summaries AS summary;

  RETURN QUERY SELECT
    modified_order.order_id,
    modified_order.restaurant_id,
    modified_order.service_location_id,
    modified_order.order_number,
    modified_order.assigned_waiter_id,
    modified_order.status,
    modified_order.total_amount,
    modified_order.updated_at,
    modified_order.baskets,
    movement_summaries;
END;
$$;

REVOKE ALL ON FUNCTION public.modify_pending_order(
  uuid, uuid, timestamptz, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.modify_pending_order(
  uuid, uuid, timestamptz, text, timestamptz, text
) TO service_role;
