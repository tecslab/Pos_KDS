CREATE SEQUENCE public.order_number_sequence AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

DO $$
DECLARE
  next_order_number bigint;
BEGIN
  SELECT COALESCE(max(substring(order_number FROM '^ORD-([0-9]+)$')::bigint), 0) + 1
  INTO next_order_number
  FROM public.orders
  WHERE order_number ~ '^ORD-[0-9]+$';

  PERFORM setval('public.order_number_sequence', next_order_number, false);
END;
$$;

REVOKE ALL ON SEQUENCE public.order_number_sequence FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.confirm_order(
  actor_user_id uuid,
  target_service_location_id uuid,
  order_notes text,
  draft_baskets_text text,
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
  notes text,
  total_amount numeric(12, 2),
  confirmed_at timestamptz,
  baskets jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  draft_baskets jsonb;
  draft_basket jsonb;
  draft_line jsonb;
  option_value jsonb;
  removal_value jsonb;
  basket_correlation_id text;
  basket_correlation_ids text[] := ARRAY[]::text[];
  product_version_id_to_confirm uuid;
  option_ids_to_confirm uuid[];
  removal_ids_to_confirm uuid[];
  option_id_to_confirm uuid;
  removal_id_to_confirm uuid;
  observation_to_confirm text;
  quantity_to_confirm bigint;
  target_restaurant_id uuid;
  location_allows_multiple boolean;
  source_ip_value inet;
  confirmation_time timestamptz;
  order_id_to_insert uuid := gen_random_uuid();
  order_number_to_insert text;
  basket_id_to_insert uuid;
  line_id_to_insert uuid;
  snapshot_id_to_insert uuid;
  basket_index integer := 0;
  persisted_basket_ordinal integer;
  nonempty_basket_count integer := 0;
  total_source_line_count integer := 0;
  canonical_line record;
  catalog_line record;
  selected_options_value jsonb;
  removed_ingredients_value jsonb;
  option_count integer;
  removal_count integer;
  option_adjustment numeric;
  removal_adjustment numeric;
  final_unit_price_value numeric;
  line_total_value numeric;
  basket_total_value numeric;
  order_total_value numeric;
  baskets_value jsonb;
BEGIN
  IF actor_user_id IS NULL
    OR target_service_location_id IS NULL
    OR draft_baskets_text IS NULL
    OR length(draft_baskets_text) > 1048576
    OR audit_occurred_at IS NULL
    OR (order_notes IS NOT NULL AND length(order_notes) > 2000)
    OR order_notes IS DISTINCT FROM NULLIF(btrim(regexp_replace(order_notes, '\s+', ' ', 'g')), '')
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'order draft is invalid' USING ERRCODE = '22023';
  END IF;

  confirmation_time := audit_occurred_at;
  IF confirmation_time < transaction_timestamp() - interval '5 minutes'
    OR confirmation_time > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'order confirmation timestamp is invalid' USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := btrim(audit_source_ip)::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'order audit source IP is invalid' USING ERRCODE = '22023';
    END;
  END IF;

  BEGIN
    draft_baskets := draft_baskets_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'order draft JSON is invalid' USING ERRCODE = '22023';
  END;

  IF jsonb_typeof(draft_baskets) IS DISTINCT FROM 'array'
    OR jsonb_array_length(draft_baskets) < 1
    OR jsonb_array_length(draft_baskets) > 100 THEN
    RAISE EXCEPTION 'order draft baskets are invalid' USING ERRCODE = '22023';
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
    AND permission.code = 'orders.create'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order confirmation is unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT location.restaurant_id, location.allows_multiple_active_orders
  INTO target_restaurant_id, location_allows_multiple
  FROM public.service_locations AS location
  JOIN public.restaurants AS restaurant ON restaurant.id = location.restaurant_id
  WHERE location.id = target_service_location_id
    AND location.is_active
    AND location.deleted_at IS NULL
    AND restaurant.is_active
    AND restaurant.deleted_at IS NULL
  FOR UPDATE OF location
  FOR SHARE OF restaurant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_CONFIRMATION_LOCATION_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT location_allows_multiple AND EXISTS (
    SELECT 1
    FROM public.orders AS active_order
    WHERE active_order.restaurant_id = target_restaurant_id
      AND active_order.service_location_id = target_service_location_id
      AND active_order.status IN ('PENDING', 'READY', 'ON_THE_WAY', 'DELIVERED')
  ) THEN
    RAISE EXCEPTION 'ORDER_CONFIRMATION_LOCATION_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMP TABLE pg_temp.order_confirmation_lines (
    basket_ordinal integer NOT NULL,
    product_version_id uuid NOT NULL,
    quantity bigint NOT NULL,
    option_ids uuid[] NOT NULL,
    removal_ids uuid[] NOT NULL,
    observation_key text NOT NULL,
    product_name text,
    base_unit_price numeric(12, 2),
    final_unit_price numeric(12, 2),
    line_total numeric(12, 2),
    tax_code text,
    tax_name text,
    tax_rate numeric(7, 6),
    price_includes_tax boolean,
    selected_options jsonb,
    removed_ingredients jsonb,
    basket_id uuid,
    line_id uuid,
    snapshot_id uuid,
    UNIQUE (
      basket_ordinal,
      product_version_id,
      option_ids,
      removal_ids,
      observation_key
    )
  ) ON COMMIT DROP;

  FOR draft_basket IN SELECT value FROM jsonb_array_elements(draft_baskets)
  LOOP
    basket_index := basket_index + 1;
    IF jsonb_typeof(draft_basket) IS DISTINCT FROM 'object'
      OR jsonb_typeof(draft_basket -> 'clientCorrelationId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(draft_basket -> 'lines') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(draft_basket) AS key(name)
        WHERE name NOT IN ('clientCorrelationId', 'lines')
      ) THEN
      RAISE EXCEPTION 'order basket is invalid' USING ERRCODE = '22023';
    END IF;

    basket_correlation_id := draft_basket ->> 'clientCorrelationId';
    IF basket_correlation_id = ''
      OR basket_correlation_id IS DISTINCT FROM btrim(basket_correlation_id)
      OR length(basket_correlation_id) > 120
      OR basket_correlation_id = ANY(basket_correlation_ids) THEN
      RAISE EXCEPTION 'order basket correlation is invalid' USING ERRCODE = '22023';
    END IF;
    basket_correlation_ids := array_append(basket_correlation_ids, basket_correlation_id);

    IF jsonb_array_length(draft_basket -> 'lines') = 0 THEN
      CONTINUE;
    END IF;
    nonempty_basket_count := nonempty_basket_count + 1;
    total_source_line_count := total_source_line_count
      + jsonb_array_length(draft_basket -> 'lines');
    IF total_source_line_count > 1000 THEN
      RAISE EXCEPTION 'order has too many lines' USING ERRCODE = '22023';
    END IF;

    FOR draft_line IN SELECT value FROM jsonb_array_elements(draft_basket -> 'lines')
    LOOP
      IF jsonb_typeof(draft_line) IS DISTINCT FROM 'object'
        OR NOT (
          draft_line ? 'productVersionId'
          AND draft_line ? 'quantity'
          AND draft_line ? 'optionIds'
          AND draft_line ? 'removableIngredientIds'
          AND draft_line ? 'observations'
        )
        OR jsonb_typeof(draft_line -> 'productVersionId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(draft_line -> 'quantity') IS DISTINCT FROM 'number'
        OR jsonb_typeof(draft_line -> 'optionIds') IS DISTINCT FROM 'array'
        OR jsonb_typeof(draft_line -> 'removableIngredientIds') IS DISTINCT FROM 'array'
        OR jsonb_typeof(draft_line -> 'observations') NOT IN ('string', 'null')
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(draft_line) AS key(name)
          WHERE name NOT IN (
            'productVersionId', 'quantity', 'optionIds',
            'removableIngredientIds', 'observations'
          )
        )
        OR (draft_line ->> 'productVersionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR (draft_line ->> 'quantity') !~ '^[1-9][0-9]*$'
        OR length(draft_line ->> 'quantity') > 10
        OR jsonb_array_length(draft_line -> 'optionIds') > 100
        OR jsonb_array_length(draft_line -> 'removableIngredientIds') > 100 THEN
        RAISE EXCEPTION 'order line is invalid' USING ERRCODE = '22023';
      END IF;

      product_version_id_to_confirm := (draft_line ->> 'productVersionId')::uuid;
      quantity_to_confirm := (draft_line ->> 'quantity')::bigint;
      IF quantity_to_confirm > 2147483647 THEN
        RAISE EXCEPTION 'order line quantity is invalid' USING ERRCODE = '22023';
      END IF;

      IF jsonb_typeof(draft_line -> 'observations') = 'null' THEN
        observation_to_confirm := '';
      ELSE
        observation_to_confirm := btrim(regexp_replace(draft_line ->> 'observations', '\s+', ' ', 'g'));
        IF length(observation_to_confirm) > 2000
          OR draft_line ->> 'observations' IS DISTINCT FROM observation_to_confirm THEN
          RAISE EXCEPTION 'order line observation is invalid' USING ERRCODE = '22023';
        END IF;
      END IF;

      option_ids_to_confirm := ARRAY[]::uuid[];
      FOR option_value IN SELECT value FROM jsonb_array_elements(draft_line -> 'optionIds')
      LOOP
        IF jsonb_typeof(option_value) IS DISTINCT FROM 'string'
          OR trim(both '"' from option_value::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'order option identifier is invalid' USING ERRCODE = '22023';
        END IF;
        option_id_to_confirm := trim(both '"' from option_value::text)::uuid;
        IF option_id_to_confirm = ANY(option_ids_to_confirm) THEN
          RAISE EXCEPTION 'order option identifier is duplicated' USING ERRCODE = '22023';
        END IF;
        option_ids_to_confirm := array_append(option_ids_to_confirm, option_id_to_confirm);
      END LOOP;
      SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::uuid[])
      INTO option_ids_to_confirm
      FROM unnest(option_ids_to_confirm) AS value;

      removal_ids_to_confirm := ARRAY[]::uuid[];
      FOR removal_value IN SELECT value FROM jsonb_array_elements(draft_line -> 'removableIngredientIds')
      LOOP
        IF jsonb_typeof(removal_value) IS DISTINCT FROM 'string'
          OR trim(both '"' from removal_value::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'order removal identifier is invalid' USING ERRCODE = '22023';
        END IF;
        removal_id_to_confirm := trim(both '"' from removal_value::text)::uuid;
        IF removal_id_to_confirm = ANY(removal_ids_to_confirm) THEN
          RAISE EXCEPTION 'order removal identifier is duplicated' USING ERRCODE = '22023';
        END IF;
        removal_ids_to_confirm := array_append(removal_ids_to_confirm, removal_id_to_confirm);
      END LOOP;
      SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::uuid[])
      INTO removal_ids_to_confirm
      FROM unnest(removal_ids_to_confirm) AS value;

      INSERT INTO pg_temp.order_confirmation_lines (
        basket_ordinal, product_version_id, quantity, option_ids,
        removal_ids, observation_key
      ) VALUES (
        basket_index, product_version_id_to_confirm, quantity_to_confirm,
        option_ids_to_confirm, removal_ids_to_confirm, observation_to_confirm
      )
      ON CONFLICT (
        basket_ordinal, product_version_id, option_ids, removal_ids, observation_key
      ) DO UPDATE
      SET quantity = pg_temp.order_confirmation_lines.quantity + EXCLUDED.quantity;
    END LOOP;
  END LOOP;

  IF nonempty_basket_count = 0
    OR NOT EXISTS (SELECT 1 FROM pg_temp.order_confirmation_lines)
    OR EXISTS (
      SELECT 1 FROM pg_temp.order_confirmation_lines WHERE quantity > 2147483647
    ) THEN
    RAISE EXCEPTION 'order must contain valid products' USING ERRCODE = '22023';
  END IF;

  FOR canonical_line IN SELECT * FROM pg_temp.order_confirmation_lines
  LOOP
    SELECT
      version.name,
      version.unit_price,
      version.tax_code,
      version.tax_name,
      version.tax_rate,
      version.price_includes_tax
    INTO catalog_line
    FROM public.product_versions AS version
    JOIN public.products AS product
      ON product.restaurant_id = version.restaurant_id
     AND product.id = version.product_id
    JOIN public.product_categories AS category
      ON category.restaurant_id = product.restaurant_id
     AND category.id = product.category_id
    JOIN public.product_catalogs AS catalog
      ON catalog.restaurant_id = product.restaurant_id
    WHERE version.restaurant_id = target_restaurant_id
      AND version.id = canonical_line.product_version_id
      AND version.version_number = (
        SELECT max(current_version.version_number)
        FROM public.product_versions AS current_version
        WHERE current_version.restaurant_id = version.restaurant_id
          AND current_version.product_id = version.product_id
      )
      AND product.is_active
      AND product.deleted_at IS NULL
      AND category.is_active
      AND category.deleted_at IS NULL
      AND catalog.is_active
      AND catalog.deleted_at IS NULL
    FOR SHARE OF version, product, category, catalog;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ORDER_CONFIRMATION_STALE_CONFIGURATION'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', option.id,
        'name', option.name,
        'priceAdjustment', option.price_adjustment
      ) ORDER BY option.id), '[]'::jsonb),
      count(option.id),
      COALESCE(sum(option.price_adjustment), 0)
    INTO selected_options_value, option_count, option_adjustment
    FROM public.product_options AS option
    WHERE option.restaurant_id = target_restaurant_id
      AND option.product_version_id = canonical_line.product_version_id
      AND option.id = ANY(canonical_line.option_ids);

    IF option_count <> cardinality(canonical_line.option_ids) THEN
      RAISE EXCEPTION 'ORDER_CONFIRMATION_STALE_CONFIGURATION'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', ingredient.id,
        'name', ingredient.name,
        'priceAdjustment', ingredient.price_adjustment
      ) ORDER BY ingredient.id), '[]'::jsonb),
      count(ingredient.id),
      COALESCE(sum(ingredient.price_adjustment), 0)
    INTO removed_ingredients_value, removal_count, removal_adjustment
    FROM public.product_removable_ingredients AS ingredient
    WHERE ingredient.restaurant_id = target_restaurant_id
      AND ingredient.product_version_id = canonical_line.product_version_id
      AND ingredient.id = ANY(canonical_line.removal_ids);

    IF removal_count <> cardinality(canonical_line.removal_ids) THEN
      RAISE EXCEPTION 'ORDER_CONFIRMATION_STALE_CONFIGURATION'
        USING ERRCODE = 'P0001';
    END IF;

    final_unit_price_value := catalog_line.unit_price
      + option_adjustment + removal_adjustment;
    line_total_value := final_unit_price_value * canonical_line.quantity;
    IF final_unit_price_value < 0
      OR final_unit_price_value > 9999999999.99
      OR line_total_value > 9999999999.99 THEN
      RAISE EXCEPTION 'order monetary value is out of range' USING ERRCODE = '22023';
    END IF;

    UPDATE pg_temp.order_confirmation_lines
    SET product_name = catalog_line.name,
        base_unit_price = catalog_line.unit_price,
        final_unit_price = final_unit_price_value,
        line_total = line_total_value,
        tax_code = catalog_line.tax_code,
        tax_name = catalog_line.tax_name,
        tax_rate = catalog_line.tax_rate,
        price_includes_tax = catalog_line.price_includes_tax,
        selected_options = selected_options_value,
        removed_ingredients = removed_ingredients_value
    WHERE basket_ordinal = canonical_line.basket_ordinal
      AND product_version_id = canonical_line.product_version_id
      AND option_ids = canonical_line.option_ids
      AND removal_ids = canonical_line.removal_ids
      AND observation_key = canonical_line.observation_key;
  END LOOP;

  SELECT sum(line_total) INTO order_total_value
  FROM pg_temp.order_confirmation_lines;
  IF order_total_value IS NULL OR order_total_value > 9999999999.99 THEN
    RAISE EXCEPTION 'order total is out of range' USING ERRCODE = '22023';
  END IF;

  order_number_to_insert := 'ORD-' || nextval('public.order_number_sequence')::text;
  INSERT INTO public.orders (
    id, restaurant_id, service_location_id, assigned_waiter_id, order_number,
    status, notes, total_amount, created_at, ready_at, on_the_way_at,
    delivered_at, paid_at, updated_at
  ) VALUES (
    order_id_to_insert, target_restaurant_id, target_service_location_id,
    actor_user_id, order_number_to_insert, 'PENDING', order_notes,
    order_total_value, confirmation_time, NULL, NULL, NULL, NULL, confirmation_time
  );

  FOR persisted_basket_ordinal IN
    SELECT DISTINCT line.basket_ordinal
    FROM pg_temp.order_confirmation_lines AS line
    ORDER BY line.basket_ordinal
  LOOP
    basket_id_to_insert := gen_random_uuid();
    SELECT sum(line_total) INTO basket_total_value
    FROM pg_temp.order_confirmation_lines
    WHERE order_confirmation_lines.basket_ordinal = persisted_basket_ordinal;

    INSERT INTO public.customer_baskets (
      id, restaurant_id, order_id, status, total_amount, created_at, paid_at
    ) VALUES (
      basket_id_to_insert, target_restaurant_id, order_id_to_insert,
      'PENDING', basket_total_value, confirmation_time, NULL
    );

    UPDATE pg_temp.order_confirmation_lines
    SET basket_id = basket_id_to_insert
    WHERE order_confirmation_lines.basket_ordinal = persisted_basket_ordinal;

    FOR canonical_line IN
      SELECT *
      FROM pg_temp.order_confirmation_lines AS line
      WHERE line.basket_ordinal = persisted_basket_ordinal
      ORDER BY line.product_version_id, line.option_ids, line.removal_ids, line.observation_key
    LOOP
      line_id_to_insert := gen_random_uuid();
      snapshot_id_to_insert := gen_random_uuid();
      INSERT INTO public.order_lines (
        id, restaurant_id, basket_id, current_snapshot_id, created_at
      ) VALUES (
        line_id_to_insert, target_restaurant_id, basket_id_to_insert,
        snapshot_id_to_insert, confirmation_time
      );
      INSERT INTO public.order_line_sale_snapshots (
        id, restaurant_id, order_line_id, revision_number, product_version_id,
        product_name, quantity, base_unit_price, final_unit_price, line_total,
        tax_code, tax_name, tax_rate, price_includes_tax, selected_options,
        removed_ingredients, observations, created_at
      ) VALUES (
        snapshot_id_to_insert, target_restaurant_id, line_id_to_insert, 1,
        canonical_line.product_version_id, canonical_line.product_name,
        canonical_line.quantity::integer, canonical_line.base_unit_price,
        canonical_line.final_unit_price, canonical_line.line_total,
        canonical_line.tax_code, canonical_line.tax_name, canonical_line.tax_rate,
        canonical_line.price_includes_tax, canonical_line.selected_options,
        canonical_line.removed_ingredients,
        NULLIF(canonical_line.observation_key, ''), confirmation_time
      );
      UPDATE pg_temp.order_confirmation_lines
      SET line_id = line_id_to_insert, snapshot_id = snapshot_id_to_insert
      WHERE order_confirmation_lines.basket_ordinal = canonical_line.basket_ordinal
        AND product_version_id = canonical_line.product_version_id
        AND option_ids = canonical_line.option_ids
        AND removal_ids = canonical_line.removal_ids
        AND observation_key = canonical_line.observation_key;
    END LOOP;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object(
    'id', basket_summary.basket_id,
    'status', 'PENDING',
    'totalAmount', basket_summary.total_amount,
    'lines', basket_summary.lines
  ) ORDER BY basket_summary.basket_ordinal)
  INTO baskets_value
  FROM (
    SELECT
      line.basket_ordinal,
      line.basket_id,
      sum(line.line_total) AS total_amount,
      jsonb_agg(jsonb_build_object(
        'id', line.line_id,
        'productVersionId', line.product_version_id,
        'productName', line.product_name,
        'quantity', line.quantity,
        'baseUnitPrice', line.base_unit_price,
        'finalUnitPrice', line.final_unit_price,
        'lineTotal', line.line_total,
        'taxCode', line.tax_code,
        'taxName', line.tax_name,
        'taxRate', line.tax_rate,
        'priceIncludesTax', line.price_includes_tax,
        'selectedOptions', line.selected_options,
        'removedIngredients', line.removed_ingredients,
        'observations', NULLIF(line.observation_key, '')
      ) ORDER BY line.line_id) AS lines
    FROM pg_temp.order_confirmation_lines AS line
    GROUP BY line.basket_ordinal, line.basket_id
  ) AS basket_summary;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id,
    confirmation_time,
    'order.confirmed',
    'order',
    order_id_to_insert::text,
    NULL,
    jsonb_build_object(
      'orderId', order_id_to_insert,
      'restaurantId', target_restaurant_id,
      'serviceLocationId', target_service_location_id,
      'orderNumber', order_number_to_insert,
      'assignedWaiterId', actor_user_id,
      'status', 'PENDING',
      'notes', order_notes,
      'totalAmount', order_total_value,
      'baskets', baskets_value
    ),
    source_ip_value
  );

  RETURN QUERY SELECT
    order_id_to_insert,
    target_restaurant_id,
    target_service_location_id,
    order_number_to_insert,
    actor_user_id,
    'PENDING'::public.order_status,
    order_notes,
    order_total_value::numeric(12, 2),
    confirmation_time,
    baskets_value;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order(
  uuid, uuid, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order(
  uuid, uuid, text, text, timestamptz, text
) TO service_role;
