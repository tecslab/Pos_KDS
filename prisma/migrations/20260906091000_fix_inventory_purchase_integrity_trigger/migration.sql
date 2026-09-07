CREATE OR REPLACE FUNCTION public.check_inventory_purchase_integrity_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'inventory_purchases' THEN
    PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'inventory_purchase_lines' THEN
    PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.purchase_id);
  ELSIF TG_TABLE_NAME = 'inventory_movements' THEN
    IF NEW.business_origin_type = 'PURCHASE' THEN
      PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.business_origin_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'operating_expenses' THEN
    IF NEW.origin_type = 'PURCHASE' THEN
      PERFORM public.assert_inventory_purchase_integrity(NEW.restaurant_id, NEW.origin_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
