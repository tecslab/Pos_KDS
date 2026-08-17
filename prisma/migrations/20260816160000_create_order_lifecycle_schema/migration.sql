CREATE TYPE public.order_status AS ENUM (
  'PENDING',
  'READY',
  'ON_THE_WAY',
  'DELIVERED',
  'PAID',
  'CANCELLED'
);

CREATE TYPE public.customer_basket_status AS ENUM ('PENDING', 'PAID');

ALTER TABLE public.service_locations
  ADD CONSTRAINT service_locations_restaurant_id_id_key UNIQUE (restaurant_id, id);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  service_location_id uuid NOT NULL,
  assigned_waiter_id uuid NOT NULL,
  order_number text NOT NULL,
  status public.order_status NOT NULL,
  notes text,
  total_amount numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at timestamptz,
  on_the_way_at timestamptz,
  delivered_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT orders_restaurant_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT orders_service_location_fkey
    FOREIGN KEY (restaurant_id, service_location_id) REFERENCES public.service_locations(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT orders_assigned_waiter_fkey
    FOREIGN KEY (assigned_waiter_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT orders_order_number_key UNIQUE (order_number),
  CONSTRAINT orders_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT orders_order_number_not_blank CHECK (btrim(order_number) <> ''),
  CONSTRAINT orders_total_amount_nonnegative CHECK (total_amount >= 0),
  CONSTRAINT orders_lifecycle_timestamps_monotonic CHECK (
    (ready_at IS NULL OR ready_at >= created_at)
    AND (on_the_way_at IS NULL OR (ready_at IS NOT NULL AND on_the_way_at >= ready_at))
    AND (delivered_at IS NULL OR (on_the_way_at IS NOT NULL AND delivered_at >= on_the_way_at))
    AND (paid_at IS NULL OR (delivered_at IS NOT NULL AND paid_at >= delivered_at))
  ),
  CONSTRAINT orders_status_timestamp_shape CHECK (
    (status = 'PENDING' AND ready_at IS NULL AND on_the_way_at IS NULL AND delivered_at IS NULL AND paid_at IS NULL)
    OR (status = 'READY' AND ready_at IS NOT NULL AND on_the_way_at IS NULL AND delivered_at IS NULL AND paid_at IS NULL)
    OR (status = 'ON_THE_WAY' AND ready_at IS NOT NULL AND on_the_way_at IS NOT NULL AND delivered_at IS NULL AND paid_at IS NULL)
    OR (status = 'DELIVERED' AND ready_at IS NOT NULL AND on_the_way_at IS NOT NULL AND delivered_at IS NOT NULL AND paid_at IS NULL)
    OR (status = 'PAID' AND ready_at IS NOT NULL AND on_the_way_at IS NOT NULL AND delivered_at IS NOT NULL AND paid_at IS NOT NULL)
    OR (status = 'CANCELLED' AND on_the_way_at IS NULL AND delivered_at IS NULL AND paid_at IS NULL)
  )
);

CREATE INDEX orders_restaurant_id_status_created_at_idx
  ON public.orders(restaurant_id, status, created_at);
CREATE INDEX orders_restaurant_id_service_location_id_status_idx
  ON public.orders(restaurant_id, service_location_id, status);
CREATE INDEX orders_assigned_waiter_id_status_idx
  ON public.orders(assigned_waiter_id, status);

CREATE TABLE public.customer_baskets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  status public.customer_basket_status NOT NULL,
  total_amount numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at timestamptz,
  CONSTRAINT customer_baskets_order_fkey
    FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customer_baskets_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT customer_baskets_total_nonnegative CHECK (total_amount >= 0),
  CONSTRAINT customer_baskets_status_timestamp_shape CHECK (
    (status = 'PENDING' AND paid_at IS NULL)
    OR (status = 'PAID' AND paid_at IS NOT NULL AND paid_at >= created_at)
  )
);

CREATE INDEX customer_baskets_restaurant_id_order_id_status_idx
  ON public.customer_baskets(restaurant_id, order_id, status);

CREATE TABLE public.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  basket_id uuid NOT NULL,
  current_snapshot_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT order_lines_basket_fkey
    FOREIGN KEY (restaurant_id, basket_id) REFERENCES public.customer_baskets(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_lines_current_snapshot_id_key UNIQUE (current_snapshot_id),
  CONSTRAINT order_lines_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT order_lines_current_snapshot_owner_key UNIQUE (restaurant_id, id, current_snapshot_id)
);

CREATE INDEX order_lines_restaurant_id_basket_id_idx
  ON public.order_lines(restaurant_id, basket_id);

CREATE TABLE public.order_line_sale_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  revision_number integer NOT NULL,
  product_version_id uuid NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL,
  base_unit_price numeric(12, 2) NOT NULL,
  final_unit_price numeric(12, 2) NOT NULL,
  line_total numeric(12, 2) NOT NULL,
  tax_code text NOT NULL,
  tax_name text NOT NULL,
  tax_rate numeric(7, 6) NOT NULL,
  price_includes_tax boolean NOT NULL,
  selected_options jsonb NOT NULL,
  removed_ingredients jsonb NOT NULL,
  observations text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT order_line_snapshots_line_fkey
    FOREIGN KEY (restaurant_id, order_line_id) REFERENCES public.order_lines(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT order_line_snapshots_product_version_fkey
    FOREIGN KEY (restaurant_id, product_version_id) REFERENCES public.product_versions(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_line_snapshots_line_revision_key UNIQUE (restaurant_id, order_line_id, revision_number),
  CONSTRAINT order_line_snapshots_current_key UNIQUE (restaurant_id, order_line_id, id),
  CONSTRAINT order_line_snapshots_revision_positive CHECK (revision_number > 0),
  CONSTRAINT order_line_snapshots_product_name_not_blank CHECK (btrim(product_name) <> ''),
  CONSTRAINT order_line_snapshots_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_line_snapshots_base_price_nonnegative CHECK (base_unit_price >= 0),
  CONSTRAINT order_line_snapshots_final_price_nonnegative CHECK (final_unit_price >= 0),
  CONSTRAINT order_line_snapshots_total_matches CHECK (line_total = quantity * final_unit_price),
  CONSTRAINT order_line_snapshots_tax_code_not_blank CHECK (btrim(tax_code) <> ''),
  CONSTRAINT order_line_snapshots_tax_name_not_blank CHECK (btrim(tax_name) <> ''),
  CONSTRAINT order_line_snapshots_tax_rate_valid CHECK (tax_rate >= 0 AND tax_rate <= 1),
  CONSTRAINT order_line_snapshots_options_array CHECK (jsonb_typeof(selected_options) = 'array'),
  CONSTRAINT order_line_snapshots_removals_array CHECK (jsonb_typeof(removed_ingredients) = 'array')
);

CREATE INDEX order_line_snapshots_product_version_idx
  ON public.order_line_sale_snapshots(restaurant_id, product_version_id);

ALTER TABLE public.order_lines
  ADD CONSTRAINT order_lines_current_snapshot_fkey
  FOREIGN KEY (restaurant_id, id, current_snapshot_id)
  REFERENCES public.order_line_sale_snapshots(restaurant_id, order_line_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.order_cancellations (
  order_id uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  cancelled_by_id uuid NOT NULL,
  previous_status public.order_status NOT NULL,
  reason text NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT order_cancellations_order_fkey
    FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_cancellations_cancelled_by_fkey
    FOREIGN KEY (cancelled_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_cancellations_restaurant_id_order_id_key UNIQUE (restaurant_id, order_id),
  CONSTRAINT order_cancellations_prior_status_valid CHECK (previous_status IN ('PENDING', 'READY')),
  CONSTRAINT order_cancellations_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE INDEX order_cancellations_cancelled_by_id_cancelled_at_idx
  ON public.order_cancellations(cancelled_by_id, cancelled_at);

CREATE FUNCTION public.validate_order_lifecycle_transition()
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

CREATE TRIGGER orders_validate_lifecycle
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_order_lifecycle_transition();

CREATE FUNCTION public.validate_basket_lifecycle_transition()
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

CREATE TRIGGER customer_baskets_validate_lifecycle
BEFORE INSERT OR UPDATE ON public.customer_baskets
FOR EACH ROW EXECUTE FUNCTION public.validate_basket_lifecycle_transition();

CREATE FUNCTION public.validate_new_order_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_status public.order_status;
  order_created_at timestamptz;
BEGIN
  SELECT status, created_at
  INTO current_status, order_created_at
  FROM public.orders
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.order_id;

  IF current_status IS NULL
    OR current_status <> NEW.previous_status
    OR current_status NOT IN ('PENDING', 'READY') THEN
    RAISE EXCEPTION 'cancellation must capture the current PENDING or READY order status'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.cancelled_at < order_created_at THEN
    RAISE EXCEPTION 'cancellation timestamp cannot precede order creation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER order_cancellations_validate_insert
BEFORE INSERT ON public.order_cancellations
FOR EACH ROW EXECUTE FUNCTION public.validate_new_order_cancellation();

CREATE FUNCTION public.reject_order_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER order_line_sale_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.order_line_sale_snapshots
FOR EACH ROW EXECUTE FUNCTION public.reject_order_history_mutation();

CREATE TRIGGER order_cancellations_immutable
BEFORE UPDATE OR DELETE ON public.order_cancellations
FOR EACH ROW EXECUTE FUNCTION public.reject_order_history_mutation();

CREATE FUNCTION public.assert_order_cancellation_consistency(order_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  order_status_to_check public.order_status;
  cancellation_count integer;
BEGIN
  SELECT status INTO order_status_to_check
  FROM public.orders
  WHERE id = order_id_to_check;

  IF order_status_to_check IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO cancellation_count
  FROM public.order_cancellations
  WHERE order_id = order_id_to_check;

  IF (order_status_to_check = 'CANCELLED' AND cancellation_count <> 1)
    OR (order_status_to_check <> 'CANCELLED' AND cancellation_count <> 0) THEN
    RAISE EXCEPTION 'order % cancellation record is inconsistent with its status', order_id_to_check
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.check_order_cancellation_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    PERFORM public.assert_order_cancellation_consistency(NEW.id);
  ELSE
    PERFORM public.assert_order_cancellation_consistency(NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER orders_cancellation_consistency
AFTER INSERT OR UPDATE OF status ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_cancellation_deferred();

CREATE CONSTRAINT TRIGGER cancellation_order_consistency
AFTER INSERT ON public.order_cancellations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_cancellation_deferred();

CREATE FUNCTION public.assert_order_totals_and_payment(order_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  stored_total numeric(12, 2);
  calculated_total numeric(12, 2);
  order_status_to_check public.order_status;
  basket_count integer;
  unpaid_basket_count integer;
BEGIN
  SELECT total_amount, status INTO stored_total, order_status_to_check
  FROM public.orders
  WHERE id = order_id_to_check;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(total_amount), 0), count(*),
         count(*) FILTER (WHERE status <> 'PAID')
  INTO calculated_total, basket_count, unpaid_basket_count
  FROM public.customer_baskets
  WHERE order_id = order_id_to_check;

  IF stored_total <> calculated_total THEN
    RAISE EXCEPTION 'order % total does not equal its basket totals', order_id_to_check
      USING ERRCODE = '23514';
  END IF;

  IF order_status_to_check = 'PAID' AND (basket_count = 0 OR unpaid_basket_count <> 0) THEN
    RAISE EXCEPTION 'paid order % must contain only paid baskets', order_id_to_check
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_basket_total(basket_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  stored_total numeric(12, 2);
  calculated_total numeric(12, 2);
BEGIN
  SELECT total_amount INTO stored_total
  FROM public.customer_baskets
  WHERE id = basket_id_to_check;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(snapshot.line_total), 0)
  INTO calculated_total
  FROM public.order_lines AS line
  JOIN public.order_line_sale_snapshots AS snapshot
    ON snapshot.restaurant_id = line.restaurant_id
   AND snapshot.order_line_id = line.id
   AND snapshot.id = line.current_snapshot_id
  WHERE line.basket_id = basket_id_to_check;

  IF stored_total <> calculated_total THEN
    RAISE EXCEPTION 'basket % total does not equal its current line snapshots', basket_id_to_check
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.check_order_totals_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    PERFORM public.assert_order_totals_and_payment(NEW.id);
  ELSIF TG_TABLE_NAME = 'customer_baskets' THEN
    IF TG_OP <> 'DELETE' THEN
      PERFORM public.assert_basket_total(NEW.id);
      PERFORM public.assert_order_totals_and_payment(NEW.order_id);
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM public.assert_basket_total(OLD.id);
      PERFORM public.assert_order_totals_and_payment(OLD.order_id);
    END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN
      PERFORM public.assert_basket_total(NEW.basket_id);
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM public.assert_basket_total(OLD.basket_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER orders_totals_and_payment_consistent
AFTER INSERT OR UPDATE OF total_amount, status ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_totals_deferred();

CREATE CONSTRAINT TRIGGER customer_baskets_totals_consistent
AFTER INSERT OR UPDATE OR DELETE ON public.customer_baskets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_totals_deferred();

CREATE CONSTRAINT TRIGGER order_lines_totals_consistent
AFTER INSERT OR UPDATE OR DELETE ON public.order_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_order_totals_deferred();

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_sale_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_cancellations ENABLE ROW LEVEL SECURITY;
