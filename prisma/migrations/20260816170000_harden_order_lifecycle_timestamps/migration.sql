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
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'order creation timestamp is immutable' USING ERRCODE = '55000';
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
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'basket creation timestamp is immutable' USING ERRCODE = '55000';
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

CREATE OR REPLACE FUNCTION public.validate_new_order_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_status public.order_status;
  order_created_at timestamptz;
  order_ready_at timestamptz;
  latest_lifecycle_at timestamptz;
BEGIN
  SELECT status, created_at, ready_at
  INTO current_status, order_created_at, order_ready_at
  FROM public.orders
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.order_id;

  IF current_status IS NULL
    OR current_status <> NEW.previous_status
    OR current_status NOT IN ('PENDING', 'READY') THEN
    RAISE EXCEPTION 'cancellation must capture the current PENDING or READY order status'
      USING ERRCODE = '23514';
  END IF;

  latest_lifecycle_at := GREATEST(
    order_created_at,
    COALESCE(order_ready_at, order_created_at)
  );

  IF NEW.cancelled_at < latest_lifecycle_at THEN
    RAISE EXCEPTION 'cancellation timestamp cannot precede the latest order lifecycle timestamp'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
