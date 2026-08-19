CREATE FUNCTION public.assert_order_is_complete(order_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = order_id_to_check) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_baskets WHERE order_id = order_id_to_check
  ) THEN
    RAISE EXCEPTION 'order % must contain at least one customer basket', order_id_to_check
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customer_baskets AS basket
    JOIN public.order_lines AS line
      ON line.restaurant_id = basket.restaurant_id
     AND line.basket_id = basket.id
    WHERE basket.order_id = order_id_to_check
  ) THEN
    RAISE EXCEPTION 'order % must contain at least one current order line', order_id_to_check
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_basket_is_complete(basket_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owning_order_id uuid;
BEGIN
  SELECT order_id INTO owning_order_id
  FROM public.customer_baskets
  WHERE id = basket_id_to_check;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.order_lines WHERE basket_id = basket_id_to_check
  ) THEN
    RAISE EXCEPTION 'customer basket % must contain at least one order line', basket_id_to_check
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.assert_order_is_complete(owning_order_id);
END;
$$;

CREATE FUNCTION public.check_order_completeness_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    PERFORM public.assert_order_is_complete(NEW.id);
  ELSIF TG_TABLE_NAME = 'customer_baskets' THEN
    IF TG_OP <> 'DELETE' THEN
      PERFORM public.assert_basket_is_complete(NEW.id);
      PERFORM public.assert_order_is_complete(NEW.order_id);
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM public.assert_basket_is_complete(OLD.id);
      PERFORM public.assert_order_is_complete(OLD.order_id);
    END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN
      PERFORM public.assert_basket_is_complete(NEW.basket_id);
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM public.assert_basket_is_complete(OLD.basket_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER orders_require_complete_aggregate
AFTER INSERT ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_completeness_deferred();

CREATE CONSTRAINT TRIGGER baskets_require_complete_aggregate
AFTER INSERT OR UPDATE OR DELETE ON public.customer_baskets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_completeness_deferred();

CREATE CONSTRAINT TRIGGER order_lines_require_complete_aggregate
AFTER INSERT OR UPDATE OR DELETE ON public.order_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_completeness_deferred();

CREATE FUNCTION public.protect_order_line_identity_and_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_revision integer;
  next_revision integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order line history cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.basket_id IS DISTINCT FROM OLD.basket_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'order line identity, ownership, and creation timestamp are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.current_snapshot_id IS DISTINCT FROM OLD.current_snapshot_id THEN
    SELECT revision_number INTO previous_revision
    FROM public.order_line_sale_snapshots
    WHERE restaurant_id = OLD.restaurant_id
      AND order_line_id = OLD.id
      AND id = OLD.current_snapshot_id;

    SELECT revision_number INTO next_revision
    FROM public.order_line_sale_snapshots
    WHERE restaurant_id = NEW.restaurant_id
      AND order_line_id = NEW.id
      AND id = NEW.current_snapshot_id;

    IF previous_revision IS NULL OR next_revision IS NULL OR next_revision <= previous_revision THEN
      RAISE EXCEPTION 'order line current snapshot must advance to a later revision'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER order_lines_protect_history
BEFORE UPDATE OR DELETE ON public.order_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_order_line_identity_and_revision();

CREATE FUNCTION public.validate_snapshot_modifications(
  modifications jsonb,
  restaurant_id_to_check uuid,
  product_version_id_to_check uuid,
  modification_kind text
)
RETURNS numeric(12, 2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  modification jsonb;
  modification_id uuid;
  configured_name text;
  configured_adjustment numeric(12, 2);
  supplied_adjustment numeric(12, 2);
  seen_ids uuid[] := ARRAY[]::uuid[];
  adjustment_total numeric(12, 2) := 0;
BEGIN
  IF jsonb_typeof(modifications) <> 'array' THEN
    RAISE EXCEPTION '% snapshot must be a JSON array', modification_kind
      USING ERRCODE = '23514';
  END IF;

  FOR modification IN SELECT value FROM jsonb_array_elements(modifications)
  LOOP
    IF jsonb_typeof(modification) <> 'object' THEN
      RAISE EXCEPTION '% snapshot entries must be JSON objects', modification_kind
        USING ERRCODE = '23514';
    END IF;

    IF NOT (
      modification ? 'id'
      AND modification ? 'name'
      AND modification ? 'priceAdjustment'
    ) OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(modification) AS object_key(key)
      WHERE key NOT IN ('id', 'name', 'priceAdjustment')
    ) THEN
      RAISE EXCEPTION '% snapshot entries must use the canonical id/name/priceAdjustment shape', modification_kind
        USING ERRCODE = '23514';
    END IF;

    IF jsonb_typeof(modification -> 'id') <> 'string'
      OR jsonb_typeof(modification -> 'name') <> 'string'
      OR btrim(modification ->> 'name') = ''
      OR jsonb_typeof(modification -> 'priceAdjustment') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION '% snapshot entry values are malformed', modification_kind
        USING ERRCODE = '23514';
    END IF;

    modification_id := (modification ->> 'id')::uuid;
    IF modification_id = ANY(seen_ids) THEN
      RAISE EXCEPTION '% snapshot contains a duplicate modification', modification_kind
        USING ERRCODE = '23514';
    END IF;
    seen_ids := array_append(seen_ids, modification_id);

    IF modification_kind = 'option' THEN
      SELECT name, price_adjustment
      INTO configured_name, configured_adjustment
      FROM public.product_options
      WHERE restaurant_id = restaurant_id_to_check
        AND product_version_id = product_version_id_to_check
        AND id = modification_id;
    ELSIF modification_kind = 'removal' THEN
      SELECT name, price_adjustment
      INTO configured_name, configured_adjustment
      FROM public.product_removable_ingredients
      WHERE restaurant_id = restaurant_id_to_check
        AND product_version_id = product_version_id_to_check
        AND id = modification_id;
    ELSE
      RAISE EXCEPTION 'unsupported snapshot modification kind' USING ERRCODE = '23514';
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION '% snapshot references a modification outside the product version', modification_kind
        USING ERRCODE = '23514';
    END IF;

    IF modification ->> 'name' <> configured_name THEN
      RAISE EXCEPTION '% snapshot name does not match catalog configuration', modification_kind
        USING ERRCODE = '23514';
    END IF;

    IF jsonb_typeof(modification -> 'priceAdjustment') = 'null' THEN
      supplied_adjustment := NULL;
    ELSE
      supplied_adjustment := (modification ->> 'priceAdjustment')::numeric(12, 2);
    END IF;

    IF supplied_adjustment IS DISTINCT FROM configured_adjustment THEN
      RAISE EXCEPTION '% snapshot price adjustment does not match catalog configuration', modification_kind
        USING ERRCODE = '23514';
    END IF;

    adjustment_total := adjustment_total + COALESCE(configured_adjustment, 0);
  END LOOP;

  RETURN adjustment_total;
END;
$$;

CREATE FUNCTION public.validate_order_line_sale_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  catalog_name text;
  catalog_price numeric(12, 2);
  catalog_tax_code text;
  catalog_tax_name text;
  catalog_tax_rate numeric(7, 6);
  catalog_price_includes_tax boolean;
  option_adjustments numeric(12, 2);
  removal_adjustments numeric(12, 2);
BEGIN
  SELECT name, unit_price, tax_code, tax_name, tax_rate, price_includes_tax
  INTO catalog_name, catalog_price, catalog_tax_code, catalog_tax_name,
       catalog_tax_rate, catalog_price_includes_tax
  FROM public.product_versions
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.product_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale snapshot product version does not exist' USING ERRCODE = '23503';
  END IF;

  IF NEW.product_name <> catalog_name
    OR NEW.base_unit_price <> catalog_price
    OR NEW.tax_code <> catalog_tax_code
    OR NEW.tax_name <> catalog_tax_name
    OR NEW.tax_rate <> catalog_tax_rate
    OR NEW.price_includes_tax <> catalog_price_includes_tax THEN
    RAISE EXCEPTION 'sale snapshot product and tax values must match the product version'
      USING ERRCODE = '23514';
  END IF;

  option_adjustments := public.validate_snapshot_modifications(
    NEW.selected_options,
    NEW.restaurant_id,
    NEW.product_version_id,
    'option'
  );
  removal_adjustments := public.validate_snapshot_modifications(
    NEW.removed_ingredients,
    NEW.restaurant_id,
    NEW.product_version_id,
    'removal'
  );

  IF NEW.final_unit_price <> NEW.base_unit_price + option_adjustments + removal_adjustments THEN
    RAISE EXCEPTION 'sale snapshot final unit price does not match configured adjustments'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER order_line_snapshots_validate_catalog
BEFORE INSERT ON public.order_line_sale_snapshots
FOR EACH ROW EXECUTE FUNCTION public.validate_order_line_sale_snapshot();

CREATE FUNCTION public.validate_payment_configuration_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  basket_created_at timestamptz;
  configured_code text;
  configured_name text;
BEGIN
  SELECT created_at INTO basket_created_at
  FROM public.customer_baskets
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.basket_id;

  SELECT code, name INTO configured_code, configured_name
  FROM public.payment_methods
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.payment_method_id;

  IF basket_created_at IS NULL OR configured_code IS NULL THEN
    RAISE EXCEPTION 'payment basket or payment method does not exist' USING ERRCODE = '23503';
  END IF;

  IF NEW.payment_method_code <> configured_code OR NEW.payment_method_name <> configured_name THEN
    RAISE EXCEPTION 'payment method snapshot must match configured method'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.recorded_at < basket_created_at THEN
    RAISE EXCEPTION 'payment timestamp cannot precede basket creation'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.overage_authorized_at IS NOT NULL AND NEW.overage_authorized_at > NEW.recorded_at THEN
    RAISE EXCEPTION 'overage authorization cannot occur after payment recording'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_validate_configuration_snapshot
BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_configuration_snapshot();

CREATE FUNCTION public.validate_expense_configuration_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  category_created_at timestamptz;
  configured_code text;
  configured_name text;
BEGIN
  SELECT created_at, code, name
  INTO category_created_at, configured_code, configured_name
  FROM public.expense_categories
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.expense_category_id;

  IF category_created_at IS NULL THEN
    RAISE EXCEPTION 'operating expense category does not exist' USING ERRCODE = '23503';
  END IF;

  IF NEW.expense_category_code <> configured_code
    OR NEW.expense_category_name <> configured_name THEN
    RAISE EXCEPTION 'operating expense category snapshot must match configured category'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.incurred_at < category_created_at OR NEW.recorded_at < category_created_at THEN
    RAISE EXCEPTION 'operating expense timestamps cannot precede category creation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER operating_expenses_validate_configuration
BEFORE INSERT ON public.operating_expenses
FOR EACH ROW EXECUTE FUNCTION public.validate_expense_configuration_snapshot();

CREATE FUNCTION public.assert_recipe_version_has_ingredient(version_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.recipe_versions WHERE id = version_id_to_check)
    AND NOT EXISTS (
      SELECT 1 FROM public.recipe_ingredients WHERE recipe_version_id = version_id_to_check
    ) THEN
    RAISE EXCEPTION 'recipe version % must contain at least one ingredient', version_id_to_check
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.check_recipe_completeness_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'recipe_versions' THEN
    PERFORM public.assert_recipe_version_has_ingredient(NEW.id);
  ELSE
    IF TG_OP <> 'DELETE' THEN
      PERFORM public.assert_recipe_version_has_ingredient(NEW.recipe_version_id);
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM public.assert_recipe_version_has_ingredient(OLD.recipe_version_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER recipe_versions_require_ingredient
AFTER INSERT ON public.recipe_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_recipe_completeness_deferred();

CREATE CONSTRAINT TRIGGER recipe_ingredients_preserve_completeness
AFTER INSERT OR UPDATE OR DELETE ON public.recipe_ingredients
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_recipe_completeness_deferred();

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_origin_matches_type
  CHECK (
    (type = 'PURCHASE' AND business_origin_type = 'PURCHASE')
    OR (type IN ('PRODUCTION_CONSUMPTION', 'PRODUCTION_OUTPUT') AND business_origin_type = 'PRODUCTION')
    OR (type = 'SALE' AND business_origin_type = 'SALE')
    OR (type = 'ADJUSTMENT' AND business_origin_type = 'ADJUSTMENT')
    OR (type = 'WASTE' AND business_origin_type = 'WASTE')
    OR (type = 'ROLLBACK' AND business_origin_type = 'ROLLBACK')
  );

CREATE UNIQUE INDEX inventory_movements_one_reversal_idx
  ON public.inventory_movements(reversed_movement_id)
  WHERE reversed_movement_id IS NOT NULL;

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
BEGIN
  SELECT item.unit_of_measure,
         (configuration.inventory_policy ->> 'allowNegativeStock')::boolean
  INTO item_unit, allow_negative_stock
  FROM public.inventory_items AS item
  JOIN public.restaurant_configurations AS configuration
    ON configuration.restaurant_id = item.restaurant_id
  WHERE item.restaurant_id = NEW.restaurant_id AND item.id = NEW.inventory_item_id
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
    SELECT 1 FROM public.production_batches
    WHERE restaurant_id = NEW.restaurant_id AND id = NEW.business_origin_id
  ) THEN
    RAISE EXCEPTION 'production movement origin must reference a same-restaurant production batch'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.business_origin_type = 'SALE' AND NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE restaurant_id = NEW.restaurant_id AND id = NEW.business_origin_id
  ) THEN
    RAISE EXCEPTION 'sale movement origin must reference a same-restaurant order'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.reversed_movement_id IS NOT NULL THEN
    IF NEW.reversed_movement_id = NEW.id THEN
      RAISE EXCEPTION 'rollback movement cannot reference itself' USING ERRCODE = '23514';
    END IF;

    SELECT quantity_delta, type, recorded_at
    INTO reversed_quantity, reversed_type, reversed_recorded_at
    FROM public.inventory_movements
    WHERE restaurant_id = NEW.restaurant_id
      AND inventory_item_id = NEW.inventory_item_id
      AND id = NEW.reversed_movement_id;

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
  END IF;

  SELECT COALESCE(sum(quantity_delta), 0)
  INTO current_balance
  FROM public.inventory_movements
  WHERE restaurant_id = NEW.restaurant_id AND inventory_item_id = NEW.inventory_item_id;

  IF current_balance + NEW.quantity_delta < 0 AND NOT allow_negative_stock THEN
    RAISE EXCEPTION 'inventory movement would produce a negative balance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_order_lifecycle_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'persisted orders must begin in PENDING status' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
      OR NEW.service_location_id IS DISTINCT FROM OLD.service_location_id
      OR NEW.assigned_waiter_id IS DISTINCT FROM OLD.assigned_waiter_id
      OR NEW.order_number IS DISTINCT FROM OLD.order_number
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'order identity, ownership, and creation timestamp are immutable'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'PENDING' AND NEW.status IN ('READY', 'CANCELLED'))
      OR (OLD.status = 'READY' AND NEW.status IN ('ON_THE_WAY', 'CANCELLED'))
      OR (OLD.status = 'ON_THE_WAY' AND NEW.status = 'DELIVERED')
      OR (OLD.status = 'DELIVERED' AND NEW.status = 'PAID')
    ) THEN
      RAISE EXCEPTION 'invalid order transition from % to %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF (OLD.ready_at IS NOT NULL AND NEW.ready_at IS DISTINCT FROM OLD.ready_at)
      OR (OLD.on_the_way_at IS NOT NULL AND NEW.on_the_way_at IS DISTINCT FROM OLD.on_the_way_at)
      OR (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
      OR (OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
      RAISE EXCEPTION 'recorded order lifecycle timestamps are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_basket_lifecycle_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'customer baskets must begin in PENDING status' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'basket identity, ownership, and creation timestamp are immutable'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.status <> OLD.status AND NOT (OLD.status = 'PENDING' AND NEW.status = 'PAID') THEN
      RAISE EXCEPTION 'invalid customer basket transition from % to %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION 'recorded basket payment timestamp is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_batch_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  recipe_output_unit text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'production batches cannot be deleted after execution begins'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  SELECT produced_unit INTO recipe_output_unit
  FROM public.recipe_versions
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.recipe_version_id;

  IF recipe_output_unit IS NULL THEN
    RAISE EXCEPTION 'production batch recipe version does not exist' USING ERRCODE = '23503';
  END IF;

  IF NEW.unit_of_measure <> recipe_output_unit THEN
    RAISE EXCEPTION 'production batch unit must match its recipe version output unit'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'production batches must begin in PLANNED status'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed production batches are immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id
    OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN
    RAISE EXCEPTION 'production batch recipe and creation identity are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'PLANNED' AND NEW.status = 'IN_PROGRESS')
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'invalid production batch transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at)
    OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at) THEN
    RAISE EXCEPTION 'recorded production lifecycle timestamps are immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
