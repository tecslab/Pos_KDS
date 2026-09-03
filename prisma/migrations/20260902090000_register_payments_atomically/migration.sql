INSERT INTO public.permissions (code, name, description)
VALUES (
  'payments.overage.authorize',
  'Authorize Payment Overage',
  'Authorize a payment above the selected basket outstanding balance with a recorded reason.'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.roles AS role
JOIN public.permissions AS permission
  ON permission.code = 'payments.overage.authorize'
WHERE role.code = 'administrator'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE FUNCTION public.register_payment(
  actor_user_id uuid,
  target_basket_id uuid,
  target_payment_method_id uuid,
  payment_amount numeric,
  payment_reference_number text,
  payment_comments text,
  overage_authorization_reason text,
  audit_occurred_at timestamptz,
  audit_source_ip text
)
RETURNS TABLE (
  payment_id uuid,
  restaurant_id uuid,
  order_id uuid,
  basket_id uuid,
  payment_method_id uuid,
  recorded_by_id uuid,
  amount numeric,
  payment_method_code text,
  payment_method_name text,
  reference_number text,
  comments text,
  recorded_at timestamptz,
  overage_authorized_by_id uuid,
  overage_authorized_at timestamptz,
  overage_reason text,
  basket_total_amount numeric,
  basket_paid_amount numeric,
  basket_outstanding_balance numeric,
  basket_previous_status public.customer_basket_status,
  basket_status public.customer_basket_status,
  order_previous_status public.order_status,
  order_status public.order_status,
  order_paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  basket_owner_order_id uuid;
  target_order public.orders%ROWTYPE;
  target_basket public.customer_baskets%ROWTYPE;
  target_method public.payment_methods%ROWTYPE;
  source_ip_value inet;
  normalized_reference text;
  normalized_comments text;
  normalized_overage_reason text;
  payment_time timestamptz;
  existing_paid numeric;
  paid_after numeric;
  outstanding_before numeric;
  outstanding_after numeric;
  overage_amount numeric;
  is_overage boolean;
  next_basket_status public.customer_basket_status;
  next_order_status public.order_status;
  next_order_paid_at timestamptz;
  new_payment_id uuid;
BEGIN
  IF actor_user_id IS NULL
    OR target_basket_id IS NULL
    OR target_payment_method_id IS NULL
    OR payment_amount IS NULL
    OR payment_amount <= 0
    OR payment_amount > 9999999999.99
    OR scale(payment_amount) > 2
    OR audit_occurred_at IS NULL
    OR (payment_reference_number IS NOT NULL AND length(btrim(payment_reference_number)) > 200)
    OR (payment_comments IS NOT NULL AND length(btrim(payment_comments)) > 2000)
    OR (overage_authorization_reason IS NOT NULL AND length(btrim(overage_authorization_reason)) > 1000)
    OR (audit_source_ip IS NOT NULL AND length(btrim(audit_source_ip)) > 64) THEN
    RAISE EXCEPTION 'Payment registration input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF audit_occurred_at < transaction_timestamp() - interval '5 minutes'
    OR audit_occurred_at > transaction_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Payment registration timestamp is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF audit_source_ip IS NOT NULL THEN
    BEGIN
      source_ip_value := NULLIF(btrim(audit_source_ip), '')::inet;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Payment registration audit source IP is invalid'
        USING ERRCODE = '22023';
    END;
  END IF;

  normalized_reference := NULLIF(regexp_replace(btrim(payment_reference_number), '\s+', ' ', 'g'), '');
  normalized_comments := NULLIF(regexp_replace(btrim(payment_comments), '\s+', ' ', 'g'), '');
  normalized_overage_reason := NULLIF(
    regexp_replace(btrim(overage_authorization_reason), '\s+', ' ', 'g'),
    ''
  );

  PERFORM 1
  FROM public.application_users AS application_user
  JOIN public.user_role_assignments AS assignment
    ON assignment.user_id = application_user.id
  JOIN public.role_permissions AS role_permission
    ON role_permission.role_id = assignment.role_id
  JOIN public.permissions AS permission
    ON permission.id = role_permission.permission_id
  WHERE application_user.id = actor_user_id
    AND application_user.is_active
    AND permission.code = 'payments.register'
  FOR SHARE OF application_user, assignment, role_permission, permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment registration is unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT basket.order_id
  INTO basket_owner_order_id
  FROM public.customer_baskets AS basket
  WHERE basket.id = target_basket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_BASKET_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT target.*
  INTO target_order
  FROM public.orders AS target
  WHERE target.id = basket_owner_order_id
  FOR UPDATE OF target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF target_order.status <> 'DELIVERED' THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_DELIVERED' USING ERRCODE = 'P0001';
  END IF;

  SELECT basket.*
  INTO target_basket
  FROM public.customer_baskets AS basket
  WHERE basket.restaurant_id = target_order.restaurant_id
    AND basket.order_id = target_order.id
    AND basket.id = target_basket_id
  FOR UPDATE OF basket;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_BASKET_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF target_basket.status = 'PAID' THEN
    RAISE EXCEPTION 'PAYMENT_BASKET_ALREADY_PAID' USING ERRCODE = 'P0001';
  END IF;

  SELECT method.*
  INTO target_method
  FROM public.payment_methods AS method
  WHERE method.restaurant_id = target_order.restaurant_id
    AND method.id = target_payment_method_id
    AND method.is_active
    AND method.deleted_at IS NULL
  FOR KEY SHARE OF method;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(payment.amount), 0)
  INTO existing_paid
  FROM public.payments AS payment
  WHERE payment.restaurant_id = target_basket.restaurant_id
    AND payment.basket_id = target_basket.id;

  IF existing_paid >= target_basket.total_amount THEN
    RAISE EXCEPTION 'PAYMENT_BASKET_BALANCE_INCONSISTENT'
      USING ERRCODE = 'P0001';
  END IF;

  outstanding_before := target_basket.total_amount - existing_paid;
  paid_after := existing_paid + payment_amount;
  is_overage := payment_amount > outstanding_before;
  overage_amount := GREATEST(payment_amount - outstanding_before, 0);

  IF is_overage THEN
    PERFORM 1
    FROM public.application_users AS application_user
    JOIN public.user_role_assignments AS assignment
      ON assignment.user_id = application_user.id
    JOIN public.role_permissions AS role_permission
      ON role_permission.role_id = assignment.role_id
    JOIN public.permissions AS permission
      ON permission.id = role_permission.permission_id
    WHERE application_user.id = actor_user_id
      AND application_user.is_active
      AND permission.code = 'payments.overage.authorize'
    FOR SHARE OF application_user, assignment, role_permission, permission;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAYMENT_OVERAGE_UNAUTHORIZED'
        USING ERRCODE = '42501';
    END IF;

    IF normalized_overage_reason IS NULL THEN
      RAISE EXCEPTION 'PAYMENT_OVERAGE_REASON_REQUIRED'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    normalized_overage_reason := NULL;
  END IF;

  payment_time := GREATEST(
    audit_occurred_at,
    target_order.updated_at + interval '1 microsecond'
  );
  outstanding_after := GREATEST(target_basket.total_amount - paid_after, 0);
  next_basket_status := CASE
    WHEN outstanding_after = 0 THEN 'PAID'::public.customer_basket_status
    ELSE 'PENDING'::public.customer_basket_status
  END;

  INSERT INTO public.payments (
    restaurant_id,
    basket_id,
    payment_method_id,
    recorded_by_id,
    amount,
    payment_method_code,
    payment_method_name,
    reference_number,
    comments,
    recorded_at,
    overage_authorized_by_id,
    overage_authorized_at,
    overage_reason
  ) VALUES (
    target_basket.restaurant_id,
    target_basket.id,
    target_method.id,
    actor_user_id,
    payment_amount,
    target_method.code,
    target_method.name,
    normalized_reference,
    normalized_comments,
    payment_time,
    CASE WHEN is_overage THEN actor_user_id ELSE NULL END,
    CASE WHEN is_overage THEN payment_time ELSE NULL END,
    normalized_overage_reason
  )
  RETURNING id INTO new_payment_id;

  IF next_basket_status = 'PAID' THEN
    UPDATE public.customer_baskets AS settled_basket
    SET status = 'PAID',
        paid_at = payment_time
    WHERE settled_basket.restaurant_id = target_basket.restaurant_id
      AND settled_basket.id = target_basket.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customer_baskets AS unsettled_basket
    WHERE unsettled_basket.restaurant_id = target_order.restaurant_id
      AND unsettled_basket.order_id = target_order.id
      AND unsettled_basket.status <> 'PAID'
  ) THEN
    next_order_status := 'PAID';
    next_order_paid_at := payment_time;
    UPDATE public.orders AS settled_order
    SET status = 'PAID',
        paid_at = payment_time,
        updated_at = payment_time
    WHERE settled_order.restaurant_id = target_order.restaurant_id
      AND settled_order.id = target_order.id;
  ELSE
    next_order_status := target_order.status;
    next_order_paid_at := target_order.paid_at;
  END IF;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id,
    payment_time,
    'payment.registered',
    'payment',
    new_payment_id::text,
    NULL,
    jsonb_build_object(
      'paymentId', new_payment_id,
      'restaurantId', target_order.restaurant_id,
      'orderId', target_order.id,
      'basketId', target_basket.id,
      'paymentMethodId', target_method.id,
      'paymentMethodCode', target_method.code,
      'paymentMethodName', target_method.name,
      'recordedById', actor_user_id,
      'amount', payment_amount,
      'referenceNumber', normalized_reference,
      'comments', normalized_comments,
      'recordedAt', payment_time,
      'basketTotalAmount', target_basket.total_amount,
      'basketPaidBefore', existing_paid,
      'basketPaidAfter', paid_after,
      'basketOutstandingBefore', outstanding_before,
      'basketOutstandingAfter', outstanding_after,
      'basketPreviousStatus', target_basket.status,
      'basketStatus', next_basket_status,
      'orderPreviousStatus', target_order.status,
      'orderStatus', next_order_status,
      'orderPaidAt', next_order_paid_at,
      'overageAmount', overage_amount,
      'overageAuthorizedById', CASE WHEN is_overage THEN actor_user_id ELSE NULL END,
      'overageAuthorizedAt', CASE WHEN is_overage THEN payment_time ELSE NULL END,
      'overageReason', normalized_overage_reason
    ),
    source_ip_value
  );

  RETURN QUERY SELECT
    new_payment_id,
    target_order.restaurant_id,
    target_order.id,
    target_basket.id,
    target_method.id,
    actor_user_id,
    payment_amount,
    target_method.code,
    target_method.name,
    normalized_reference,
    normalized_comments,
    payment_time,
    CASE WHEN is_overage THEN actor_user_id ELSE NULL END,
    CASE WHEN is_overage THEN payment_time ELSE NULL END,
    normalized_overage_reason,
    target_basket.total_amount,
    paid_after,
    outstanding_after,
    target_basket.status,
    next_basket_status,
    target_order.status,
    next_order_status,
    next_order_paid_at;
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment(
  uuid, uuid, uuid, numeric, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_payment(
  uuid, uuid, uuid, numeric, text, text, text, timestamptz, text
) TO service_role;
