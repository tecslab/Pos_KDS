CREATE TYPE public.inventory_item_type AS ENUM (
  'RAW_INGREDIENT',
  'PRODUCED_ITEM',
  'RESALE_ITEM'
);

CREATE TYPE public.inventory_movement_type AS ENUM (
  'PURCHASE',
  'PRODUCTION_CONSUMPTION',
  'PRODUCTION_OUTPUT',
  'SALE',
  'ADJUSTMENT',
  'WASTE',
  'ROLLBACK'
);

CREATE TYPE public.inventory_business_origin_type AS ENUM (
  'PURCHASE',
  'PRODUCTION',
  'SALE',
  'ADJUSTMENT',
  'WASTE',
  'ROLLBACK'
);

CREATE TYPE public.inventory_alert_status AS ENUM ('ACTIVE', 'RESOLVED');

ALTER TABLE public.restaurant_configurations
  ADD CONSTRAINT restaurant_configurations_negative_stock_policy_valid
  CHECK (
    inventory_policy ? 'allowNegativeStock'
    AND jsonb_typeof(inventory_policy -> 'allowNegativeStock') = 'boolean'
  );

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  type public.inventory_item_type NOT NULL,
  unit_of_measure text NOT NULL,
  minimum_stock_level numeric(14, 3) NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT inventory_items_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_items_restaurant_id_name_key UNIQUE (restaurant_id, name),
  CONSTRAINT inventory_items_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT inventory_items_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT inventory_items_unit_not_blank CHECK (btrim(unit_of_measure) <> ''),
  CONSTRAINT inventory_items_minimum_nonnegative CHECK (minimum_stock_level >= 0),
  CONSTRAINT inventory_items_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active)
);

CREATE INDEX inventory_items_restaurant_id_type_is_active_idx
  ON public.inventory_items(restaurant_id, type, is_active);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  type public.inventory_movement_type NOT NULL,
  quantity_delta numeric(14, 3) NOT NULL,
  unit_of_measure text NOT NULL,
  recorded_by_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  business_origin_type public.inventory_business_origin_type NOT NULL,
  business_origin_id uuid NOT NULL,
  comments text,
  reversed_movement_id uuid,
  CONSTRAINT inventory_movements_item_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_movements_recorded_by_fkey
    FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_movements_item_id_key UNIQUE (restaurant_id, inventory_item_id, id),
  CONSTRAINT inventory_movements_reversed_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id, reversed_movement_id) REFERENCES public.inventory_movements(restaurant_id, inventory_item_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_movements_quantity_nonzero CHECK (quantity_delta <> 0),
  CONSTRAINT inventory_movements_unit_not_blank CHECK (btrim(unit_of_measure) <> ''),
  CONSTRAINT inventory_movements_direction_valid CHECK (
    (type IN ('PURCHASE', 'PRODUCTION_OUTPUT') AND quantity_delta > 0)
    OR (type IN ('PRODUCTION_CONSUMPTION', 'SALE', 'WASTE') AND quantity_delta < 0)
    OR type IN ('ADJUSTMENT', 'ROLLBACK')
  ),
  CONSTRAINT inventory_movements_reversal_type_valid CHECK (
    reversed_movement_id IS NULL OR type = 'ROLLBACK'
  )
);

CREATE INDEX inventory_movements_item_recorded_at_idx
  ON public.inventory_movements(restaurant_id, inventory_item_id, recorded_at);
CREATE INDEX inventory_movements_origin_idx
  ON public.inventory_movements(restaurant_id, business_origin_type, business_origin_id);
CREATE INDEX inventory_movements_recorded_by_id_recorded_at_idx
  ON public.inventory_movements(recorded_by_id, recorded_at);
CREATE INDEX inventory_movements_reversed_movement_id_idx
  ON public.inventory_movements(reversed_movement_id);

CREATE TABLE public.inventory_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  status public.inventory_alert_status NOT NULL,
  threshold numeric(14, 3) NOT NULL,
  observed_balance numeric(14, 3) NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at timestamptz,
  CONSTRAINT inventory_alerts_item_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inventory_alerts_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT inventory_alerts_threshold_nonnegative CHECK (threshold >= 0),
  CONSTRAINT inventory_alerts_status_timestamp_shape CHECK (
    (status = 'ACTIVE' AND resolved_at IS NULL)
    OR (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_at >= opened_at)
  )
);

CREATE INDEX inventory_alerts_item_status_opened_at_idx
  ON public.inventory_alerts(restaurant_id, inventory_item_id, status, opened_at);
CREATE UNIQUE INDEX inventory_alerts_one_active_per_item_idx
  ON public.inventory_alerts(restaurant_id, inventory_item_id)
  WHERE status = 'ACTIVE';

CREATE FUNCTION public.protect_inventory_item_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.type IS DISTINCT FROM OLD.type OR NEW.unit_of_measure IS DISTINCT FROM OLD.unit_of_measure)
    AND EXISTS (
      SELECT 1
      FROM public.inventory_movements
      WHERE restaurant_id = OLD.restaurant_id AND inventory_item_id = OLD.id
    ) THEN
    RAISE EXCEPTION 'inventory item type and unit are immutable after its first movement'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_items_protect_identity
BEFORE UPDATE OF type, unit_of_measure ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.protect_inventory_item_identity();

CREATE FUNCTION public.validate_inventory_movement()
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

  IF NEW.reversed_movement_id IS NOT NULL THEN
    SELECT quantity_delta
    INTO reversed_quantity
    FROM public.inventory_movements
    WHERE restaurant_id = NEW.restaurant_id
      AND inventory_item_id = NEW.inventory_item_id
      AND id = NEW.reversed_movement_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'reversed inventory movement does not exist'
        USING ERRCODE = '23503';
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

CREATE TRIGGER inventory_movements_validate_insert
BEFORE INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_movement();

CREATE FUNCTION public.reject_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'inventory movement history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inventory_movements_immutable
BEFORE UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_movement_mutation();

CREATE FUNCTION public.validate_inventory_alert_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' OR NEW.resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'inventory alerts must begin active and unresolved'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory alert history cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'ACTIVE'
    OR NEW.status <> 'RESOLVED'
    OR NEW.resolved_at IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.inventory_item_id IS DISTINCT FROM OLD.inventory_item_id
    OR NEW.threshold IS DISTINCT FROM OLD.threshold
    OR NEW.observed_balance IS DISTINCT FROM OLD.observed_balance
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'inventory alerts only allow active-to-resolved transitions'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_alerts_validate_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_alerts
FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_alert_lifecycle();

CREATE VIEW public.inventory_balances
WITH (security_invoker = true)
AS
SELECT
  item.restaurant_id,
  item.id AS inventory_item_id,
  item.unit_of_measure,
  COALESCE(sum(movement.quantity_delta), 0)::numeric(14, 3) AS current_balance
FROM public.inventory_items AS item
LEFT JOIN public.inventory_movements AS movement
  ON movement.restaurant_id = item.restaurant_id
 AND movement.inventory_item_id = item.id
GROUP BY item.restaurant_id, item.id, item.unit_of_measure;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_alerts ENABLE ROW LEVEL SECURITY;
