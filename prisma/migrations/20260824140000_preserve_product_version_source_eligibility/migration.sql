CREATE OR REPLACE FUNCTION public.validate_product_version_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.recipe_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('product-version-recipe:' || NEW.recipe_id::text, 0)
    );
  END IF;
  IF NEW.resale_inventory_item_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('product-version-resale:' || NEW.resale_inventory_item_id::text, 0)
    );
  END IF;

  IF NEW.recipe_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.recipes
    WHERE restaurant_id = NEW.restaurant_id
      AND id = NEW.recipe_id
      AND product_id = NEW.product_id
      AND is_active
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product version recipe is not eligible for this product'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resale_inventory_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_items
    WHERE restaurant_id = NEW.restaurant_id
      AND id = NEW.resale_inventory_item_id
      AND type = 'RESALE_ITEM'
      AND is_active
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product version resale inventory item is not eligible'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_recipe_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (
    NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
  ) THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('product-version-recipe:' || OLD.id::text, 0)
    );
  END IF;

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

  IF (
    NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
  ) AND EXISTS (
    SELECT 1
    FROM public.product_versions
    WHERE restaurant_id = OLD.restaurant_id AND recipe_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'recipe product is immutable after a product version links it'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_inventory_item_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('product-version-resale:' || OLD.id::text, 0)
    );
  END IF;

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

  IF NEW.type IS DISTINCT FROM OLD.type AND EXISTS (
    SELECT 1
    FROM public.product_versions
    WHERE restaurant_id = OLD.restaurant_id
      AND resale_inventory_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'resale inventory item type is immutable after a product version links it'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
