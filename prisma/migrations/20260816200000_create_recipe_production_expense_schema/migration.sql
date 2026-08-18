CREATE TYPE public.production_batch_status AS ENUM (
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED'
);

CREATE TYPE public.expense_origin_type AS ENUM ('MANUAL', 'PURCHASE');

CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  output_inventory_item_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT recipes_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT recipes_product_fkey
    FOREIGN KEY (restaurant_id, product_id) REFERENCES public.products(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT recipes_output_item_fkey
    FOREIGN KEY (restaurant_id, output_inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT recipes_restaurant_id_name_key UNIQUE (restaurant_id, name),
  CONSTRAINT recipes_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT recipes_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT recipes_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active)
);

CREATE INDEX recipes_restaurant_id_product_id_is_active_idx
  ON public.recipes(restaurant_id, product_id, is_active);
CREATE INDEX recipes_restaurant_id_output_inventory_item_id_idx
  ON public.recipes(restaurant_id, output_inventory_item_id);

CREATE TABLE public.recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  recipe_id uuid NOT NULL,
  version_number integer NOT NULL,
  produced_quantity numeric(14, 3) NOT NULL,
  produced_unit text NOT NULL,
  created_by_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recipe_versions_recipe_fkey
    FOREIGN KEY (restaurant_id, recipe_id) REFERENCES public.recipes(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT recipe_versions_created_by_fkey
    FOREIGN KEY (created_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT recipe_versions_recipe_number_key UNIQUE (restaurant_id, recipe_id, version_number),
  CONSTRAINT recipe_versions_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT recipe_versions_number_positive CHECK (version_number > 0),
  CONSTRAINT recipe_versions_quantity_positive CHECK (produced_quantity > 0),
  CONSTRAINT recipe_versions_unit_not_blank CHECK (btrim(produced_unit) <> '')
);

CREATE INDEX recipe_versions_created_by_id_created_at_idx
  ON public.recipe_versions(created_by_id, created_at);

CREATE TABLE public.recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  recipe_version_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  required_quantity numeric(14, 3) NOT NULL,
  unit_of_measure text NOT NULL,
  CONSTRAINT recipe_ingredients_version_fkey
    FOREIGN KEY (restaurant_id, recipe_version_id) REFERENCES public.recipe_versions(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT recipe_ingredients_item_fkey
    FOREIGN KEY (restaurant_id, inventory_item_id) REFERENCES public.inventory_items(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT recipe_ingredients_version_item_key UNIQUE (restaurant_id, recipe_version_id, inventory_item_id),
  CONSTRAINT recipe_ingredients_quantity_positive CHECK (required_quantity > 0),
  CONSTRAINT recipe_ingredients_unit_not_blank CHECK (btrim(unit_of_measure) <> '')
);

CREATE INDEX recipe_ingredients_restaurant_id_inventory_item_id_idx
  ON public.recipe_ingredients(restaurant_id, inventory_item_id);

CREATE TABLE public.production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  recipe_version_id uuid NOT NULL,
  status public.production_batch_status NOT NULL,
  planned_quantity numeric(14, 3) NOT NULL,
  produced_quantity numeric(14, 3),
  unit_of_measure text NOT NULL,
  created_by_id uuid NOT NULL,
  completed_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  CONSTRAINT production_batches_recipe_version_fkey
    FOREIGN KEY (restaurant_id, recipe_version_id) REFERENCES public.recipe_versions(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT production_batches_created_by_fkey
    FOREIGN KEY (created_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT production_batches_completed_by_fkey
    FOREIGN KEY (completed_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT production_batches_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT production_batches_planned_quantity_positive CHECK (planned_quantity > 0),
  CONSTRAINT production_batches_unit_not_blank CHECK (btrim(unit_of_measure) <> ''),
  CONSTRAINT production_batches_timestamps_monotonic CHECK (
    (started_at IS NULL OR started_at >= created_at)
    AND (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
  ),
  CONSTRAINT production_batches_status_shape CHECK (
    (
      status = 'PLANNED'
      AND started_at IS NULL
      AND completed_at IS NULL
      AND produced_quantity IS NULL
      AND completed_by_id IS NULL
    )
    OR (
      status = 'IN_PROGRESS'
      AND started_at IS NOT NULL
      AND completed_at IS NULL
      AND produced_quantity IS NULL
      AND completed_by_id IS NULL
    )
    OR (
      status = 'COMPLETED'
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND produced_quantity > 0
      AND completed_by_id IS NOT NULL
    )
  )
);

CREATE INDEX production_batches_restaurant_id_status_created_at_idx
  ON public.production_batches(restaurant_id, status, created_at);
CREATE INDEX production_batches_recipe_created_idx
  ON public.production_batches(restaurant_id, recipe_version_id, created_at);
CREATE INDEX production_batches_created_by_id_created_at_idx
  ON public.production_batches(created_by_id, created_at);
CREATE INDEX production_batches_completed_by_id_completed_at_idx
  ON public.production_batches(completed_by_id, completed_at);

CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT expense_categories_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT expense_categories_restaurant_id_code_key UNIQUE (restaurant_id, code),
  CONSTRAINT expense_categories_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT expense_categories_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT expense_categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT expense_categories_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active)
);

CREATE INDEX expense_categories_restaurant_id_is_active_name_idx
  ON public.expense_categories(restaurant_id, is_active, name);

CREATE TABLE public.operating_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  expense_category_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL,
  description text NOT NULL,
  incurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by_id uuid NOT NULL,
  reference_number text,
  comments text,
  expense_category_code text NOT NULL,
  expense_category_name text NOT NULL,
  origin_type public.expense_origin_type NOT NULL,
  origin_id uuid,
  CONSTRAINT operating_expenses_category_fkey
    FOREIGN KEY (restaurant_id, expense_category_id) REFERENCES public.expense_categories(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT operating_expenses_recorded_by_fkey
    FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT operating_expenses_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT operating_expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT operating_expenses_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT operating_expenses_category_code_not_blank CHECK (btrim(expense_category_code) <> ''),
  CONSTRAINT operating_expenses_category_name_not_blank CHECK (btrim(expense_category_name) <> ''),
  CONSTRAINT operating_expenses_origin_pair_valid CHECK (
    (origin_type = 'MANUAL' AND origin_id IS NULL)
    OR (origin_type = 'PURCHASE' AND origin_id IS NOT NULL)
  )
);

CREATE INDEX operating_expenses_category_incurred_idx
  ON public.operating_expenses(restaurant_id, expense_category_id, incurred_at);
CREATE INDEX operating_expenses_restaurant_id_origin_type_origin_id_idx
  ON public.operating_expenses(restaurant_id, origin_type, origin_id);
CREATE INDEX operating_expenses_recorded_by_id_recorded_at_idx
  ON public.operating_expenses(recorded_by_id, recorded_at);

CREATE FUNCTION public.validate_recipe_output_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  output_item_type public.inventory_item_type;
BEGIN
  SELECT type INTO output_item_type
  FROM public.inventory_items
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.output_inventory_item_id;

  IF output_item_type IS NULL THEN
    RAISE EXCEPTION 'recipe output inventory item does not exist' USING ERRCODE = '23503';
  END IF;

  IF output_item_type <> 'PRODUCED_ITEM' THEN
    RAISE EXCEPTION 'recipe output inventory item must be a produced item'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER recipes_validate_output_item
BEFORE INSERT OR UPDATE OF restaurant_id, output_inventory_item_id ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.validate_recipe_output_item();

CREATE FUNCTION public.protect_recipe_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (
    NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.output_inventory_item_id IS DISTINCT FROM OLD.output_inventory_item_id
  ) AND EXISTS (
    SELECT 1
    FROM public.recipe_versions
    WHERE restaurant_id = OLD.restaurant_id AND recipe_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'recipe product and output item are immutable after its first version'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER recipes_protect_identity
BEFORE UPDATE OF restaurant_id, product_id, output_inventory_item_id ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.protect_recipe_identity();

CREATE FUNCTION public.validate_recipe_version_output()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  output_unit text;
BEGIN
  SELECT item.unit_of_measure
  INTO output_unit
  FROM public.recipes AS recipe
  JOIN public.inventory_items AS item
    ON item.restaurant_id = recipe.restaurant_id
   AND item.id = recipe.output_inventory_item_id
  WHERE recipe.restaurant_id = NEW.restaurant_id AND recipe.id = NEW.recipe_id;

  IF output_unit IS NULL THEN
    RAISE EXCEPTION 'recipe output inventory item does not exist' USING ERRCODE = '23503';
  END IF;

  IF NEW.produced_unit <> output_unit THEN
    RAISE EXCEPTION 'recipe version output unit must match its inventory item unit'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER recipe_versions_validate_output
BEFORE INSERT ON public.recipe_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_recipe_version_output();

CREATE FUNCTION public.validate_recipe_ingredient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ingredient_type public.inventory_item_type;
  ingredient_unit text;
BEGIN
  SELECT type, unit_of_measure
  INTO ingredient_type, ingredient_unit
  FROM public.inventory_items
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.inventory_item_id;

  IF ingredient_type IS NULL THEN
    RAISE EXCEPTION 'recipe ingredient inventory item does not exist' USING ERRCODE = '23503';
  END IF;

  IF ingredient_type <> 'RAW_INGREDIENT' THEN
    RAISE EXCEPTION 'recipe ingredients must be raw inventory items'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.unit_of_measure <> ingredient_unit THEN
    RAISE EXCEPTION 'recipe ingredient unit must match its inventory item unit'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER recipe_ingredients_validate_item
BEFORE INSERT ON public.recipe_ingredients
FOR EACH ROW EXECUTE FUNCTION public.validate_recipe_ingredient();

CREATE FUNCTION public.reject_recipe_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER recipe_versions_immutable
BEFORE UPDATE OR DELETE ON public.recipe_versions
FOR EACH ROW EXECUTE FUNCTION public.reject_recipe_history_mutation();

CREATE TRIGGER recipe_ingredients_immutable
BEFORE UPDATE OR DELETE ON public.recipe_ingredients
FOR EACH ROW EXECUTE FUNCTION public.reject_recipe_history_mutation();

CREATE OR REPLACE FUNCTION public.protect_inventory_item_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type OR NEW.unit_of_measure IS DISTINCT FROM OLD.unit_of_measure THEN
    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements
      WHERE restaurant_id = OLD.restaurant_id AND inventory_item_id = OLD.id
    ) OR EXISTS (
      SELECT 1
      FROM public.recipes
      WHERE restaurant_id = OLD.restaurant_id AND output_inventory_item_id = OLD.id
    ) OR EXISTS (
      SELECT 1
      FROM public.recipe_ingredients
      WHERE restaurant_id = OLD.restaurant_id AND inventory_item_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'inventory item type and unit are immutable after operational use'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_production_batch_lifecycle()
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

  IF NEW.created_at IS DISTINCT FROM OLD.created_at
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

CREATE TRIGGER production_batches_validate_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON public.production_batches
FOR EACH ROW EXECUTE FUNCTION public.validate_production_batch_lifecycle();

CREATE FUNCTION public.reject_operating_expense_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'operating expense history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER operating_expenses_immutable
BEFORE UPDATE OR DELETE ON public.operating_expenses
FOR EACH ROW EXECUTE FUNCTION public.reject_operating_expense_mutation();

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_expenses ENABLE ROW LEVEL SECURITY;
