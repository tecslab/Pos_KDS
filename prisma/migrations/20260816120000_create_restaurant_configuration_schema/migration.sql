CREATE TABLE public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz,
  CONSTRAINT restaurants_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT restaurants_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active)
);

CREATE TABLE public.restaurant_configurations (
  restaurant_id uuid PRIMARY KEY,
  address text,
  tax_id text,
  contact_information jsonb,
  logo_url text,
  receipt_header text,
  receipt_footer text,
  thermal_printer_configuration jsonb,
  service_charge_rate numeric(7, 6) NOT NULL,
  preparation_warning_threshold_minutes integer NOT NULL,
  preparation_critical_threshold_minutes integer NOT NULL,
  delivery_warning_threshold_minutes integer NOT NULL,
  delivery_critical_threshold_minutes integer NOT NULL,
  inventory_policy jsonb NOT NULL,
  printing_behavior jsonb NOT NULL,
  business_hours jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT restaurant_configurations_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT restaurant_configurations_service_charge_rate_valid
    CHECK (service_charge_rate >= 0 AND service_charge_rate <= 1),
  CONSTRAINT restaurant_configurations_preparation_thresholds_valid
    CHECK (
      preparation_warning_threshold_minutes >= 0
      AND preparation_critical_threshold_minutes >= preparation_warning_threshold_minutes
    ),
  CONSTRAINT restaurant_configurations_delivery_thresholds_valid
    CHECK (
      delivery_warning_threshold_minutes >= 0
      AND delivery_critical_threshold_minutes >= delivery_warning_threshold_minutes
    ),
  CONSTRAINT restaurant_configurations_contact_information_object
    CHECK (contact_information IS NULL OR jsonb_typeof(contact_information) = 'object'),
  CONSTRAINT restaurant_configurations_thermal_printer_configuration_object
    CHECK (
      thermal_printer_configuration IS NULL
      OR jsonb_typeof(thermal_printer_configuration) = 'object'
    ),
  CONSTRAINT restaurant_configurations_inventory_policy_object
    CHECK (jsonb_typeof(inventory_policy) = 'object'),
  CONSTRAINT restaurant_configurations_printing_behavior_object
    CHECK (jsonb_typeof(printing_behavior) = 'object'),
  CONSTRAINT restaurant_configurations_business_hours_object
    CHECK (jsonb_typeof(business_hours) = 'object')
);

CREATE TABLE public.service_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  display_order integer NOT NULL,
  is_active boolean NOT NULL,
  allows_multiple_active_orders boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz,
  CONSTRAINT service_locations_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT service_locations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT service_locations_type_not_blank CHECK (btrim(type) <> ''),
  CONSTRAINT service_locations_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT service_locations_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active),
  CONSTRAINT service_locations_restaurant_id_name_key UNIQUE (restaurant_id, name)
);

CREATE INDEX service_locations_restaurant_id_is_active_display_order_idx
  ON public.service_locations(restaurant_id, is_active, display_order);

CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  display_order integer NOT NULL,
  is_active boolean NOT NULL,
  bank_account_configuration jsonb,
  receipt_configuration jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz,
  CONSTRAINT payment_methods_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payment_methods_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT payment_methods_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT payment_methods_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT payment_methods_bank_account_configuration_object
    CHECK (
      bank_account_configuration IS NULL
      OR jsonb_typeof(bank_account_configuration) = 'object'
    ),
  CONSTRAINT payment_methods_receipt_configuration_object
    CHECK (receipt_configuration IS NULL OR jsonb_typeof(receipt_configuration) = 'object'),
  CONSTRAINT payment_methods_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active),
  CONSTRAINT payment_methods_restaurant_id_code_key UNIQUE (restaurant_id, code)
);

CREATE INDEX payment_methods_restaurant_id_is_active_display_order_idx
  ON public.payment_methods(restaurant_id, is_active, display_order);

CREATE TABLE public.restaurant_tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  rate numeric(7, 6) NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz,
  CONSTRAINT restaurant_tax_rates_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT restaurant_tax_rates_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT restaurant_tax_rates_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT restaurant_tax_rates_rate_valid CHECK (rate >= 0 AND rate <= 1),
  CONSTRAINT restaurant_tax_rates_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active),
  CONSTRAINT restaurant_tax_rates_restaurant_id_code_key UNIQUE (restaurant_id, code)
);

CREATE INDEX restaurant_tax_rates_restaurant_id_is_active_idx
  ON public.restaurant_tax_rates(restaurant_id, is_active);

CREATE FUNCTION public.assert_restaurant_has_configuration(restaurant_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.restaurants WHERE id = restaurant_id_to_check)
    AND NOT EXISTS (
      SELECT 1
      FROM public.restaurant_configurations
      WHERE restaurant_id = restaurant_id_to_check
    ) THEN
    RAISE EXCEPTION 'restaurant % must retain a configuration', restaurant_id_to_check
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_new_restaurant_has_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_restaurant_has_configuration(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER restaurants_require_configuration
AFTER INSERT ON public.restaurants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_new_restaurant_has_configuration();

CREATE FUNCTION public.assert_configuration_removal_keeps_restaurant_configured()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_restaurant_has_configuration(OLD.restaurant_id);
  IF TG_OP = 'UPDATE' AND NEW.restaurant_id <> OLD.restaurant_id THEN
    PERFORM public.assert_restaurant_has_configuration(NEW.restaurant_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER restaurant_configurations_preserve_on_delete
AFTER DELETE ON public.restaurant_configurations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_configuration_removal_keeps_restaurant_configured();

CREATE CONSTRAINT TRIGGER restaurant_configurations_preserve_on_restaurant_change
AFTER UPDATE OF restaurant_id ON public.restaurant_configurations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_configuration_removal_keeps_restaurant_configured();

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tax_rates ENABLE ROW LEVEL SECURITY;
