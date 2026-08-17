ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_restaurant_id_id_key UNIQUE (restaurant_id, id);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  basket_id uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  recorded_by_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL,
  payment_method_code text NOT NULL,
  payment_method_name text NOT NULL,
  reference_number text,
  comments text,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  overage_authorized_by_id uuid,
  overage_authorized_at timestamptz,
  overage_reason text,
  CONSTRAINT payments_basket_fkey
    FOREIGN KEY (restaurant_id, basket_id) REFERENCES public.customer_baskets(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payments_method_fkey
    FOREIGN KEY (restaurant_id, payment_method_id) REFERENCES public.payment_methods(restaurant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payments_recorded_by_fkey
    FOREIGN KEY (recorded_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payments_overage_authorizer_fkey
    FOREIGN KEY (overage_authorized_by_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payments_restaurant_id_id_key UNIQUE (restaurant_id, id),
  CONSTRAINT payments_amount_positive CHECK (amount > 0),
  CONSTRAINT payments_method_code_not_blank CHECK (btrim(payment_method_code) <> ''),
  CONSTRAINT payments_method_name_not_blank CHECK (btrim(payment_method_name) <> ''),
  CONSTRAINT payments_overage_evidence_all_or_none CHECK (
    (
      overage_authorized_by_id IS NULL
      AND overage_authorized_at IS NULL
      AND overage_reason IS NULL
    )
    OR (
      overage_authorized_by_id IS NOT NULL
      AND overage_authorized_at IS NOT NULL
      AND overage_reason IS NOT NULL
      AND btrim(overage_reason) <> ''
    )
  )
);

CREATE INDEX payments_restaurant_id_basket_id_recorded_at_idx
  ON public.payments(restaurant_id, basket_id, recorded_at);
CREATE INDEX payments_restaurant_id_payment_method_id_idx
  ON public.payments(restaurant_id, payment_method_id);
CREATE INDEX payments_recorded_by_id_recorded_at_idx
  ON public.payments(recorded_by_id, recorded_at);
CREATE INDEX payments_overage_authorized_by_id_idx
  ON public.payments(overage_authorized_by_id);

CREATE FUNCTION public.validate_payment_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  basket_total numeric(12, 2);
  recorded_total numeric(12, 2);
  has_overage_evidence boolean;
BEGIN
  SELECT total_amount
  INTO basket_total
  FROM public.customer_baskets
  WHERE restaurant_id = NEW.restaurant_id AND id = NEW.basket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment basket does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(sum(amount), 0)
  INTO recorded_total
  FROM public.payments
  WHERE restaurant_id = NEW.restaurant_id AND basket_id = NEW.basket_id;

  has_overage_evidence := NEW.overage_authorized_by_id IS NOT NULL
    AND NEW.overage_authorized_at IS NOT NULL
    AND NEW.overage_reason IS NOT NULL
    AND btrim(NEW.overage_reason) <> '';

  IF recorded_total + NEW.amount > basket_total AND NOT has_overage_evidence THEN
    RAISE EXCEPTION 'payment exceeds the customer basket outstanding balance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_validate_balance
BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_balance();

CREATE FUNCTION public.reject_payment_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'payment history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER payments_immutable
BEFORE UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.reject_payment_history_mutation();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
