ALTER TABLE public.restaurant_tax_rates
  ADD CONSTRAINT restaurant_tax_rates_restaurant_id_id_key UNIQUE (restaurant_id, id);

CREATE TABLE public.product_catalogs (
  restaurant_id uuid PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz,
  CONSTRAINT product_catalogs_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_catalogs_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT product_catalogs_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active)
);

CREATE INDEX product_catalogs_restaurant_id_is_active_idx
  ON public.product_catalogs(restaurant_id, is_active);

CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  display_order integer NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz,
  CONSTRAINT product_categories_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_categories_catalog_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.product_catalogs(restaurant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT product_categories_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT product_categories_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active),
  CONSTRAINT product_categories_restaurant_id_name_key UNIQUE (restaurant_id, name),
  CONSTRAINT product_categories_restaurant_id_id_key UNIQUE (restaurant_id, id)
);

CREATE INDEX product_categories_restaurant_id_is_active_display_order_idx
  ON public.product_categories(restaurant_id, is_active, display_order);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  category_id uuid NOT NULL,
  display_order integer NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz,
  CONSTRAINT products_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT products_category_fkey
    FOREIGN KEY (restaurant_id, category_id) REFERENCES public.product_categories(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT products_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT products_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active),
  CONSTRAINT products_restaurant_id_id_key UNIQUE (restaurant_id, id)
);

CREATE INDEX products_restaurant_id_category_id_is_active_display_order_idx
  ON public.products(restaurant_id, category_id, is_active, display_order);

CREATE TABLE public.product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  version_number integer NOT NULL,
  name text NOT NULL,
  unit_price numeric(12, 2) NOT NULL,
  printer_alias text NOT NULL,
  tax_rate_id uuid NOT NULL,
  tax_code text NOT NULL,
  tax_name text NOT NULL,
  tax_rate numeric(7, 6) NOT NULL,
  price_includes_tax boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_versions_product_fkey
    FOREIGN KEY (restaurant_id, product_id) REFERENCES public.products(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_versions_tax_rate_fkey
    FOREIGN KEY (restaurant_id, tax_rate_id) REFERENCES public.restaurant_tax_rates(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_versions_version_number_positive CHECK (version_number > 0),
  CONSTRAINT product_versions_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT product_versions_unit_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT product_versions_printer_alias_not_blank CHECK (btrim(printer_alias) <> ''),
  CONSTRAINT product_versions_tax_code_not_blank CHECK (btrim(tax_code) <> ''),
  CONSTRAINT product_versions_tax_name_not_blank CHECK (btrim(tax_name) <> ''),
  CONSTRAINT product_versions_tax_rate_valid CHECK (tax_rate >= 0 AND tax_rate <= 1),
  CONSTRAINT product_versions_restaurant_id_product_id_version_number_key UNIQUE (restaurant_id, product_id, version_number),
  CONSTRAINT product_versions_restaurant_id_id_key UNIQUE (restaurant_id, id)
);

CREATE INDEX product_versions_restaurant_id_product_id_version_number_idx
  ON public.product_versions(restaurant_id, product_id, version_number);

CREATE INDEX product_versions_restaurant_id_tax_rate_id_idx
  ON public.product_versions(restaurant_id, tax_rate_id);

CREATE TABLE public.product_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  product_version_id uuid NOT NULL,
  name text NOT NULL,
  price_adjustment numeric(12, 2),
  display_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_options_product_version_fkey
    FOREIGN KEY (restaurant_id, product_version_id) REFERENCES public.product_versions(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_options_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT product_options_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT product_options_restaurant_id_product_version_id_name_key UNIQUE (restaurant_id, product_version_id, name)
);

CREATE INDEX product_options_version_display_order_idx
  ON public.product_options(restaurant_id, product_version_id, display_order);

CREATE TABLE public.product_removable_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  product_version_id uuid NOT NULL,
  name text NOT NULL,
  price_adjustment numeric(12, 2),
  display_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_removable_ingredients_product_version_fkey
    FOREIGN KEY (restaurant_id, product_version_id) REFERENCES public.product_versions(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_removable_ingredients_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT product_removable_ingredients_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT product_removable_ingredients_version_name_key UNIQUE (restaurant_id, product_version_id, name)
);

CREATE INDEX product_removable_ingredients_version_display_order_idx
  ON public.product_removable_ingredients(restaurant_id, product_version_id, display_order);

CREATE FUNCTION public.reject_product_catalog_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER product_versions_immutable
BEFORE UPDATE OR DELETE ON public.product_versions
FOR EACH ROW EXECUTE FUNCTION public.reject_product_catalog_history_mutation();

CREATE TRIGGER product_options_immutable
BEFORE UPDATE OR DELETE ON public.product_options
FOR EACH ROW EXECUTE FUNCTION public.reject_product_catalog_history_mutation();

CREATE TRIGGER product_removable_ingredients_immutable
BEFORE UPDATE OR DELETE ON public.product_removable_ingredients
FOR EACH ROW EXECUTE FUNCTION public.reject_product_catalog_history_mutation();

ALTER TABLE public.product_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_removable_ingredients ENABLE ROW LEVEL SECURITY;
