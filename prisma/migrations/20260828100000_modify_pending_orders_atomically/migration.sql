CREATE TABLE public.order_line_removals (
  order_line_id uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  removed_snapshot_id uuid NOT NULL,
  removed_by_id uuid NOT NULL,
  removed_at timestamptz NOT NULL,
  CONSTRAINT order_line_removals_line_fkey
    FOREIGN KEY (restaurant_id, order_line_id)
    REFERENCES public.order_lines(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_line_removals_snapshot_fkey
    FOREIGN KEY (restaurant_id, order_line_id, removed_snapshot_id)
    REFERENCES public.order_line_sale_snapshots(restaurant_id, order_line_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_line_removals_actor_fkey
    FOREIGN KEY (removed_by_id) REFERENCES public.application_users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_line_removals_restaurant_line_key UNIQUE (restaurant_id, order_line_id),
  CONSTRAINT order_line_removals_snapshot_owner_key UNIQUE (restaurant_id, order_line_id, removed_snapshot_id)
);

CREATE INDEX order_line_removals_removed_by_at_idx
  ON public.order_line_removals(removed_by_id, removed_at);

CREATE FUNCTION public.reject_order_line_removal_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'order line removals are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER order_line_removals_immutable
BEFORE UPDATE OR DELETE ON public.order_line_removals
FOR EACH ROW EXECUTE FUNCTION public.reject_order_line_removal_mutation();

ALTER TABLE public.order_line_removals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.assert_order_is_complete(order_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = order_id_to_check) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_baskets WHERE order_id = order_id_to_check) THEN
    RAISE EXCEPTION 'order % must contain at least one customer basket', order_id_to_check USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.customer_baskets AS basket
    JOIN public.order_lines AS line
      ON line.restaurant_id = basket.restaurant_id AND line.basket_id = basket.id
    LEFT JOIN public.order_line_removals AS removal
      ON removal.restaurant_id = line.restaurant_id AND removal.order_line_id = line.id
    WHERE basket.order_id = order_id_to_check AND removal.order_line_id IS NULL
  ) THEN
    RAISE EXCEPTION 'order % must contain at least one current order line', order_id_to_check USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_basket_is_complete(basket_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE owning_order_id uuid;
BEGIN
  SELECT order_id INTO owning_order_id FROM public.customer_baskets WHERE id = basket_id_to_check;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.order_lines AS line
    LEFT JOIN public.order_line_removals AS removal
      ON removal.restaurant_id = line.restaurant_id AND removal.order_line_id = line.id
    WHERE line.basket_id = basket_id_to_check AND removal.order_line_id IS NULL
  ) THEN
    RAISE EXCEPTION 'customer basket % must contain at least one order line', basket_id_to_check USING ERRCODE = '23514';
  END IF;
  PERFORM public.assert_order_is_complete(owning_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_basket_total(basket_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE stored_total numeric(12, 2); calculated_total numeric(12, 2);
BEGIN
  SELECT total_amount INTO stored_total FROM public.customer_baskets WHERE id = basket_id_to_check;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(sum(snapshot.line_total), 0) INTO calculated_total
  FROM public.order_lines AS line
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.restaurant_id = line.restaurant_id
   AND snapshot.order_line_id = line.id AND snapshot.id = line.current_snapshot_id
  LEFT JOIN public.order_line_removals AS removal
    ON removal.restaurant_id = line.restaurant_id AND removal.order_line_id = line.id
  WHERE line.basket_id = basket_id_to_check AND removal.order_line_id IS NULL;
  IF stored_total <> calculated_total THEN
    RAISE EXCEPTION 'basket % total does not equal its current line snapshots', basket_id_to_check USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.check_order_line_removal_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE owning_basket_id uuid;
BEGIN
  SELECT basket_id INTO owning_basket_id
  FROM public.order_lines
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.order_line_id;
  PERFORM public.assert_basket_is_complete(owning_basket_id);
  PERFORM public.assert_basket_total(owning_basket_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER order_line_removals_require_complete_aggregate
AFTER INSERT ON public.order_line_removals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_line_removal_deferred();

CREATE FUNCTION public.order_active_aggregate_json(order_id_to_read uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'orderId', target_order.id,
    'restaurantId', target_order.restaurant_id,
    'serviceLocationId', target_order.service_location_id,
    'orderNumber', target_order.order_number,
    'assignedWaiterId', target_order.assigned_waiter_id,
    'status', target_order.status,
    'notes', target_order.notes,
    'totalAmount', target_order.total_amount,
    'updatedAt', target_order.updated_at,
    'baskets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', basket.id,
        'restaurantId', basket.restaurant_id,
        'status', basket.status,
        'totalAmount', basket.total_amount,
        'lines', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', line.id,
            'currentSnapshotId', snapshot.id,
            'revisionNumber', snapshot.revision_number,
            'productVersionId', snapshot.product_version_id,
            'productName', snapshot.product_name,
            'quantity', snapshot.quantity,
            'baseUnitPrice', snapshot.base_unit_price,
            'finalUnitPrice', snapshot.final_unit_price,
            'lineTotal', snapshot.line_total,
            'taxCode', snapshot.tax_code,
            'taxName', snapshot.tax_name,
            'taxRate', snapshot.tax_rate,
            'priceIncludesTax', snapshot.price_includes_tax,
            'selectedOptions', snapshot.selected_options,
            'removedIngredients', snapshot.removed_ingredients,
            'observations', snapshot.observations
          ) ORDER BY line.created_at, line.id)
          FROM public.order_lines AS line
          JOIN public.order_line_sale_snapshots AS snapshot
            ON snapshot.restaurant_id = line.restaurant_id
           AND snapshot.order_line_id = line.id AND snapshot.id = line.current_snapshot_id
          LEFT JOIN public.order_line_removals AS removal
            ON removal.restaurant_id = line.restaurant_id AND removal.order_line_id = line.id
          WHERE line.restaurant_id = basket.restaurant_id
            AND line.basket_id = basket.id AND removal.order_line_id IS NULL
        ), '[]'::jsonb)
      ) ORDER BY basket.created_at, basket.id)
      FROM public.customer_baskets AS basket
      WHERE basket.restaurant_id = target_order.restaurant_id AND basket.order_id = target_order.id
    ), '[]'::jsonb)
  )
  FROM public.orders AS target_order
  WHERE target_order.id = order_id_to_read;
$$;

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
  baskets jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operations jsonb;
  operation jsonb;
  operation_kind text;
  target_order public.orders%ROWTYPE;
  source_ip_value inet;
  previous_aggregate jsonb;
  new_aggregate jsonb;
  basket_id_value uuid;
  line_id_value uuid;
  expected_snapshot_id uuid;
  product_version_id_value uuid;
  current_snapshot public.order_line_sale_snapshots%ROWTYPE;
  quantity_value integer;
  option_ids uuid[];
  removal_ids uuid[];
  selected_options_value jsonb;
  removed_ingredients_value jsonb;
  observation_value text;
  option_count integer;
  removal_count integer;
  option_adjustment numeric(12, 2);
  removal_adjustment numeric(12, 2);
  product_record record;
  new_line_id uuid;
  new_snapshot_id uuid;
  new_revision integer;
  final_unit_price_value numeric(12, 2);
  line_total_value numeric(12, 2);
  active_line_count integer;
  changed boolean := false;
BEGIN
  IF actor_user_id IS NULL OR target_order_id IS NULL OR expected_order_updated_at IS NULL
    OR operations_text IS NULL OR length(operations_text) > 1048576 OR audit_occurred_at IS NULL
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'order modification is invalid' USING ERRCODE = '22023';
  END IF;
  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'order modification timestamp is invalid' USING ERRCODE = '22023';
  END IF;
  IF audit_source_ip IS NOT NULL THEN
    BEGIN source_ip_value := btrim(audit_source_ip)::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'order audit source IP is invalid' USING ERRCODE = '22023';
    END;
  END IF;
  BEGIN operations := operations_text::jsonb;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'order operations JSON is invalid' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(operations) IS DISTINCT FROM 'array'
    OR jsonb_array_length(operations) < 1 OR jsonb_array_length(operations) > 1000 THEN
    RAISE EXCEPTION 'order operations are invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.application_users AS application_user
  JOIN public.user_role_assignments AS assignment ON assignment.user_id = application_user.id
  JOIN public.role_permissions AS role_permission ON role_permission.role_id = assignment.role_id
  JOIN public.permissions AS permission ON permission.id = role_permission.permission_id
  WHERE application_user.id = actor_user_id AND application_user.is_active
    AND permission.code = 'orders.edit'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN RAISE EXCEPTION 'order modification is unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT * INTO target_order FROM public.orders WHERE id = target_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_MODIFICATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF target_order.status <> 'PENDING' THEN RAISE EXCEPTION 'ORDER_MODIFICATION_NOT_PENDING' USING ERRCODE = 'P0001'; END IF;
  IF target_order.updated_at IS DISTINCT FROM expected_order_updated_at THEN
    RAISE EXCEPTION 'ORDER_MODIFICATION_STALE_ORDER' USING ERRCODE = 'P0001';
  END IF;
  IF audit_occurred_at < target_order.updated_at THEN
    RAISE EXCEPTION 'order modification timestamp precedes current order' USING ERRCODE = '22023';
  END IF;
  previous_aggregate := public.order_active_aggregate_json(target_order_id);

  CREATE TEMP TABLE pg_temp.touched_order_lines (line_id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.add_correlations (correlation_id text PRIMARY KEY) ON COMMIT DROP;

  FOR operation IN SELECT value FROM jsonb_array_elements(operations)
  LOOP
    IF jsonb_typeof(operation) IS DISTINCT FROM 'object'
      OR jsonb_typeof(operation -> 'kind') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'order operation shape is invalid' USING ERRCODE = '22023';
    END IF;
    operation_kind := operation ->> 'kind';
    IF operation_kind NOT IN ('add', 'replace', 'remove') THEN
      RAISE EXCEPTION 'order operation kind is invalid' USING ERRCODE = '22023';
    END IF;

    IF operation_kind = 'add' THEN
      BEGIN
        basket_id_value := (operation ->> 'basketId')::uuid;
        product_version_id_value := (operation ->> 'productVersionId')::uuid;
        INSERT INTO pg_temp.add_correlations VALUES (operation ->> 'clientCorrelationId');
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'order add identifiers are invalid' USING ERRCODE = '22023';
      END;
      IF operation ->> 'clientCorrelationId' IS NULL OR operation ->> 'clientCorrelationId' = ''
        OR length(operation ->> 'clientCorrelationId') > 120 THEN
        RAISE EXCEPTION 'order add correlation is invalid' USING ERRCODE = '22023';
      END IF;
      PERFORM 1 FROM public.customer_baskets
      WHERE restaurant_id = target_order.restaurant_id AND id = basket_id_value
        AND order_id = target_order.id AND status = 'PENDING' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_MODIFICATION_STALE_ORDER' USING ERRCODE = 'P0001'; END IF;
    ELSE
      BEGIN
        line_id_value := (operation ->> 'lineId')::uuid;
        expected_snapshot_id := (operation ->> 'expectedCurrentSnapshotId')::uuid;
        INSERT INTO pg_temp.touched_order_lines VALUES (line_id_value);
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'order line identifiers are invalid' USING ERRCODE = '22023';
      END;
      SELECT snapshot.* INTO current_snapshot
      FROM public.order_lines AS line
      JOIN public.customer_baskets AS basket
        ON basket.restaurant_id = line.restaurant_id AND basket.id = line.basket_id
      JOIN public.order_line_sale_snapshots AS snapshot
        ON snapshot.restaurant_id = line.restaurant_id
       AND snapshot.order_line_id = line.id AND snapshot.id = line.current_snapshot_id
      LEFT JOIN public.order_line_removals AS removed
        ON removed.restaurant_id = line.restaurant_id AND removed.order_line_id = line.id
      WHERE line.restaurant_id = target_order.restaurant_id AND line.id = line_id_value
        AND basket.order_id = target_order.id AND removed.order_line_id IS NULL
      FOR UPDATE OF line;
      IF NOT FOUND OR current_snapshot.id IS DISTINCT FROM expected_snapshot_id THEN
        RAISE EXCEPTION 'ORDER_MODIFICATION_STALE_ORDER' USING ERRCODE = 'P0001';
      END IF;
      SELECT basket_id INTO basket_id_value FROM public.order_lines WHERE id = line_id_value;
    END IF;

    IF operation_kind = 'remove' THEN
      INSERT INTO public.order_line_removals (
        order_line_id, restaurant_id, removed_snapshot_id, removed_by_id, removed_at
      ) VALUES (line_id_value, target_order.restaurant_id, expected_snapshot_id, actor_user_id, audit_occurred_at);
      changed := true;
      CONTINUE;
    END IF;

    IF jsonb_typeof(operation -> 'quantity') IS DISTINCT FROM 'number'
      OR (operation ->> 'quantity') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'order line quantity is invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN quantity_value := (operation ->> 'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'order line quantity is invalid' USING ERRCODE = '22023';
    END;
    IF jsonb_typeof(operation -> 'optionIds') IS DISTINCT FROM 'array'
      OR jsonb_typeof(operation -> 'removableIngredientIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(operation -> 'optionIds') > 100
      OR jsonb_array_length(operation -> 'removableIngredientIds') > 100 THEN
      RAISE EXCEPTION 'order line configuration is invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
      SELECT COALESCE(array_agg(value::uuid ORDER BY value::uuid), ARRAY[]::uuid[])
      INTO option_ids FROM jsonb_array_elements_text(operation -> 'optionIds') AS item(value);
      SELECT COALESCE(array_agg(value::uuid ORDER BY value::uuid), ARRAY[]::uuid[])
      INTO removal_ids FROM jsonb_array_elements_text(operation -> 'removableIngredientIds') AS item(value);
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'order line configuration identifiers are invalid' USING ERRCODE = '22023';
    END;
    IF cardinality(option_ids) <> (SELECT count(DISTINCT value) FROM unnest(option_ids) AS value)
      OR cardinality(removal_ids) <> (SELECT count(DISTINCT value) FROM unnest(removal_ids) AS value) THEN
      RAISE EXCEPTION 'order line configuration identifiers are duplicated' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(operation -> 'observations') = 'null' THEN observation_value := NULL;
    ELSIF jsonb_typeof(operation -> 'observations') = 'string' THEN
      observation_value := NULLIF(btrim(regexp_replace(operation ->> 'observations', '\s+', ' ', 'g')), '');
      IF length(COALESCE(observation_value, '')) > 2000
        OR operation ->> 'observations' IS DISTINCT FROM observation_value THEN
        RAISE EXCEPTION 'order line observation is invalid' USING ERRCODE = '22023';
      END IF;
    ELSE RAISE EXCEPTION 'order line observation is invalid' USING ERRCODE = '22023';
    END IF;

    IF operation_kind = 'add' THEN
      SELECT version.name, version.unit_price, version.tax_code, version.tax_name,
        version.tax_rate, version.price_includes_tax
      INTO product_record
      FROM public.product_versions AS version
      JOIN public.products AS product
        ON product.restaurant_id = version.restaurant_id AND product.id = version.product_id
      JOIN public.product_categories AS category
        ON category.restaurant_id = product.restaurant_id AND category.id = product.category_id
      JOIN public.product_catalogs AS catalog ON catalog.restaurant_id = product.restaurant_id
      WHERE version.restaurant_id = target_order.restaurant_id AND version.id = product_version_id_value
        AND version.version_number = (SELECT max(latest.version_number) FROM public.product_versions AS latest
          WHERE latest.restaurant_id = version.restaurant_id AND latest.product_id = version.product_id)
        AND product.is_active AND product.deleted_at IS NULL
        AND category.is_active AND category.deleted_at IS NULL
        AND catalog.is_active AND catalog.deleted_at IS NULL
      FOR SHARE OF version, product, category, catalog;
      IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_MODIFICATION_STALE_CONFIGURATION' USING ERRCODE = 'P0001'; END IF;
    ELSE
      product_version_id_value := current_snapshot.product_version_id;
      SELECT current_snapshot.product_name AS name, current_snapshot.base_unit_price AS unit_price,
        current_snapshot.tax_code AS tax_code, current_snapshot.tax_name AS tax_name,
        current_snapshot.tax_rate AS tax_rate, current_snapshot.price_includes_tax AS price_includes_tax
      INTO product_record;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', option_row.id, 'name', option_row.name,
      'priceAdjustment', option_row.price_adjustment) ORDER BY option_row.id), '[]'::jsonb),
      count(option_row.id), COALESCE(sum(option_row.price_adjustment), 0)
    INTO selected_options_value, option_count, option_adjustment
    FROM public.product_options AS option_row
    WHERE option_row.restaurant_id = target_order.restaurant_id
      AND option_row.product_version_id = product_version_id_value AND option_row.id = ANY(option_ids);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', removal_row.id, 'name', removal_row.name,
      'priceAdjustment', removal_row.price_adjustment) ORDER BY removal_row.id), '[]'::jsonb),
      count(removal_row.id), COALESCE(sum(removal_row.price_adjustment), 0)
    INTO removed_ingredients_value, removal_count, removal_adjustment
    FROM public.product_removable_ingredients AS removal_row
    WHERE removal_row.restaurant_id = target_order.restaurant_id
      AND removal_row.product_version_id = product_version_id_value AND removal_row.id = ANY(removal_ids);
    IF option_count <> cardinality(option_ids) OR removal_count <> cardinality(removal_ids) THEN
      RAISE EXCEPTION 'ORDER_MODIFICATION_STALE_CONFIGURATION' USING ERRCODE = 'P0001';
    END IF;
    final_unit_price_value := product_record.unit_price + option_adjustment + removal_adjustment;
    line_total_value := final_unit_price_value * quantity_value;
    IF final_unit_price_value < 0 OR final_unit_price_value > 9999999999.99 OR line_total_value > 9999999999.99 THEN
      RAISE EXCEPTION 'order line monetary value is invalid' USING ERRCODE = '22023';
    END IF;

    IF operation_kind = 'replace'
      AND quantity_value = current_snapshot.quantity
      AND selected_options_value = current_snapshot.selected_options
      AND removed_ingredients_value = current_snapshot.removed_ingredients
      AND observation_value IS NOT DISTINCT FROM current_snapshot.observations THEN
      CONTINUE;
    END IF;

    new_snapshot_id := gen_random_uuid();
    IF operation_kind = 'add' THEN
      new_line_id := gen_random_uuid(); new_revision := 1;
      INSERT INTO public.order_lines (id, restaurant_id, basket_id, current_snapshot_id, created_at)
      VALUES (new_line_id, target_order.restaurant_id, basket_id_value, new_snapshot_id, audit_occurred_at);
    ELSE
      new_line_id := line_id_value; new_revision := current_snapshot.revision_number + 1;
    END IF;
    INSERT INTO public.order_line_sale_snapshots (
      id, restaurant_id, order_line_id, revision_number, product_version_id, product_name,
      quantity, base_unit_price, final_unit_price, line_total, tax_code, tax_name,
      tax_rate, price_includes_tax, selected_options, removed_ingredients, observations, created_at
    ) VALUES (
      new_snapshot_id, target_order.restaurant_id, new_line_id, new_revision,
      product_version_id_value, product_record.name, quantity_value, product_record.unit_price,
      final_unit_price_value, line_total_value, product_record.tax_code, product_record.tax_name,
      product_record.tax_rate, product_record.price_includes_tax, selected_options_value,
      removed_ingredients_value, observation_value, audit_occurred_at
    );
    IF operation_kind = 'replace' THEN
      UPDATE public.order_lines SET current_snapshot_id = new_snapshot_id
      WHERE restaurant_id = target_order.restaurant_id AND id = line_id_value;
    END IF;
    changed := true;
  END LOOP;

  IF NOT changed THEN RAISE EXCEPTION 'order modification is a no-op' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO active_line_count
  FROM public.order_lines AS line
  JOIN public.customer_baskets AS basket
    ON basket.restaurant_id = line.restaurant_id AND basket.id = line.basket_id
  LEFT JOIN public.order_line_removals AS removed
    ON removed.restaurant_id = line.restaurant_id AND removed.order_line_id = line.id
  WHERE basket.order_id = target_order.id AND removed.order_line_id IS NULL;
  IF active_line_count < 1 OR EXISTS (
    SELECT 1 FROM public.customer_baskets AS basket
    WHERE basket.order_id = target_order.id AND NOT EXISTS (
      SELECT 1 FROM public.order_lines AS line
      LEFT JOIN public.order_line_removals AS removed
        ON removed.restaurant_id = line.restaurant_id AND removed.order_line_id = line.id
      WHERE line.restaurant_id = basket.restaurant_id AND line.basket_id = basket.id
        AND removed.order_line_id IS NULL
    )
  ) THEN RAISE EXCEPTION 'order modification cannot leave an empty aggregate' USING ERRCODE = '22023'; END IF;

  UPDATE public.customer_baskets AS basket SET total_amount = calculated.total
  FROM (
    SELECT basket_inner.id, sum(snapshot.line_total)::numeric(12, 2) AS total
    FROM public.customer_baskets AS basket_inner
    JOIN public.order_lines AS line
      ON line.restaurant_id = basket_inner.restaurant_id AND line.basket_id = basket_inner.id
    JOIN public.order_line_sale_snapshots AS snapshot
      ON snapshot.restaurant_id = line.restaurant_id AND snapshot.order_line_id = line.id
     AND snapshot.id = line.current_snapshot_id
    LEFT JOIN public.order_line_removals AS removed
      ON removed.restaurant_id = line.restaurant_id AND removed.order_line_id = line.id
    WHERE basket_inner.order_id = target_order.id AND removed.order_line_id IS NULL
    GROUP BY basket_inner.id
  ) AS calculated
  WHERE basket.id = calculated.id;

  UPDATE public.orders SET total_amount = (
    SELECT sum(basket.total_amount) FROM public.customer_baskets AS basket WHERE basket.order_id = target_order.id
  ), updated_at = audit_occurred_at WHERE id = target_order.id;

  new_aggregate := public.order_active_aggregate_json(target_order.id);
  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id, previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id, audit_occurred_at, 'order.updated', 'order', target_order.id::text,
    previous_aggregate, new_aggregate, source_ip_value
  );

  RETURN QUERY SELECT
    target_order.id,
    target_order.restaurant_id,
    target_order.service_location_id,
    target_order.order_number,
    target_order.assigned_waiter_id,
    'PENDING'::public.order_status,
    (new_aggregate ->> 'totalAmount')::numeric(12, 2),
    (new_aggregate ->> 'updatedAt')::timestamptz,
    new_aggregate -> 'baskets';
END;
$$;

REVOKE ALL ON FUNCTION public.modify_pending_order(uuid, uuid, timestamptz, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.modify_pending_order(uuid, uuid, timestamptz, text, timestamptz, text)
  TO service_role;
