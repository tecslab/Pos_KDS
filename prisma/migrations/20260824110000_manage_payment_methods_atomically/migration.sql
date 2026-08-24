CREATE FUNCTION public.save_payment_method(
  actor_user_id uuid,
  target_restaurant_id uuid,
  target_method_id uuid,
  method_code text,
  method_name text,
  method_display_order integer,
  method_is_active boolean,
  method_is_bank_transfer boolean,
  bank_name text,
  bank_account_holder text,
  bank_account_number text,
  receipt_header text,
  receipt_footer text,
  audit_event_text text
)
RETURNS SETOF public.payment_methods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_method public.payment_methods%ROWTYPE;
  method_exists boolean;
  audit_event jsonb;
  previous_values jsonb;
  next_values jsonb;
  next_bank jsonb;
  next_receipt jsonb;
  expected_action text;
BEGIN
  IF target_restaurant_id IS NULL OR target_method_id IS NULL
    OR method_code IS NULL OR method_code !~ '^[a-z][a-z0-9_]{0,49}$'
    OR method_name IS NULL OR btrim(method_name) = '' OR length(btrim(method_name)) > 120
    OR method_display_order IS NULL OR method_display_order < 0 OR method_display_order > 100000
    OR method_is_active IS NULL OR method_is_bank_transfer IS NULL
    OR length(btrim(COALESCE(bank_name, ''))) > 120
    OR length(btrim(COALESCE(bank_account_holder, ''))) > 120
    OR length(btrim(COALESCE(bank_account_number, ''))) > 80
    OR length(btrim(COALESCE(receipt_header, ''))) > 500
    OR length(btrim(COALESCE(receipt_footer, ''))) > 500
    OR (NOT method_is_bank_transfer AND (
      btrim(COALESCE(bank_name, '')) <> '' OR btrim(COALESCE(bank_account_holder, '')) <> ''
      OR btrim(COALESCE(bank_account_number, '')) <> '')) THEN
    RAISE EXCEPTION 'payment method input is invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    audit_event := audit_event_text::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(audit_event) IS DISTINCT FROM 'object'
    OR audit_event ->> 'actorId' IS DISTINCT FROM actor_user_id::text
    OR audit_event ->> 'entityType' IS DISTINCT FROM 'payment_method'
    OR audit_event ->> 'entityId' IS DISTINCT FROM target_method_id::text
    OR jsonb_typeof(audit_event -> 'newValues') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_method_id::text, 0));
  PERFORM 1 FROM public.restaurants
  WHERE id = target_restaurant_id AND is_active AND deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant was not found' USING ERRCODE = '23503';
  END IF;
  SELECT * INTO current_method FROM public.payment_methods
  WHERE id = target_method_id AND restaurant_id = target_restaurant_id FOR UPDATE;
  method_exists := FOUND;

  IF method_exists THEN
    previous_values := jsonb_build_object(
      'restaurantId', current_method.restaurant_id, 'code', current_method.code,
      'name', current_method.name, 'displayOrder', current_method.display_order,
      'isActive', current_method.is_active,
      'isBankTransfer', current_method.bank_account_configuration ->> 'kind' = 'BANK_TRANSFER',
      'bankName', COALESCE(current_method.bank_account_configuration ->> 'bankName', ''),
      'accountHolder', COALESCE(current_method.bank_account_configuration ->> 'accountHolder', ''),
      'accountNumber', COALESCE(current_method.bank_account_configuration ->> 'accountNumber', ''),
      'receiptHeader', COALESCE(current_method.receipt_configuration ->> 'header', ''),
      'receiptFooter', COALESCE(current_method.receipt_configuration ->> 'footer', '')
    );
    next_bank := COALESCE(current_method.bank_account_configuration, '{}'::jsonb);
    next_receipt := COALESCE(current_method.receipt_configuration, '{}'::jsonb);
  ELSE
    previous_values := NULL;
    next_bank := '{}'::jsonb;
    next_receipt := '{}'::jsonb;
  END IF;

  IF method_is_bank_transfer THEN
    next_bank := next_bank || jsonb_build_object('kind', 'BANK_TRANSFER');
    IF btrim(COALESCE(bank_name, '')) = '' THEN next_bank := next_bank - 'bankName';
    ELSE next_bank := next_bank || jsonb_build_object('bankName', btrim(bank_name)); END IF;
    IF btrim(COALESCE(bank_account_holder, '')) = '' THEN next_bank := next_bank - 'accountHolder';
    ELSE next_bank := next_bank || jsonb_build_object('accountHolder', btrim(bank_account_holder)); END IF;
    IF btrim(COALESCE(bank_account_number, '')) = '' THEN next_bank := next_bank - 'accountNumber';
    ELSE next_bank := next_bank || jsonb_build_object('accountNumber', btrim(bank_account_number)); END IF;
  ELSE
    next_bank := next_bank - ARRAY['kind', 'bankName', 'accountHolder', 'accountNumber'];
  END IF;
  IF btrim(COALESCE(receipt_header, '')) = '' THEN next_receipt := next_receipt - 'header';
  ELSE next_receipt := next_receipt || jsonb_build_object('header', btrim(receipt_header)); END IF;
  IF btrim(COALESCE(receipt_footer, '')) = '' THEN next_receipt := next_receipt - 'footer';
  ELSE next_receipt := next_receipt || jsonb_build_object('footer', btrim(receipt_footer)); END IF;

  next_values := jsonb_build_object(
    'restaurantId', target_restaurant_id, 'code', method_code, 'name', btrim(method_name),
    'displayOrder', method_display_order, 'isActive', method_is_active,
    'isBankTransfer', method_is_bank_transfer, 'bankName', btrim(COALESCE(bank_name, '')),
    'accountHolder', btrim(COALESCE(bank_account_holder, '')),
    'accountNumber', btrim(COALESCE(bank_account_number, '')),
    'receiptHeader', btrim(COALESCE(receipt_header, '')),
    'receiptFooter', btrim(COALESCE(receipt_footer, ''))
  );
  IF NOT method_exists THEN expected_action := 'payment_method.created';
  ELSIF current_method.is_active IS DISTINCT FROM method_is_active THEN
    IF method_is_active THEN expected_action := 'payment_method.activated';
    ELSE expected_action := 'payment_method.deactivated'; END IF;
  ELSE expected_action := 'payment_method.updated'; END IF;

  IF audit_event -> 'previousValues' IS DISTINCT FROM previous_values
    OR audit_event -> 'newValues' IS DISTINCT FROM next_values
    OR audit_event ->> 'action' IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'audit snapshot is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.payment_methods (
    id, restaurant_id, code, name, display_order, is_active,
    bank_account_configuration, receipt_configuration, updated_at, deleted_at
  ) VALUES (
    target_method_id, target_restaurant_id, method_code, btrim(method_name),
    method_display_order, method_is_active, NULLIF(next_bank, '{}'::jsonb),
    NULLIF(next_receipt, '{}'::jsonb), CURRENT_TIMESTAMP, NULL
  ) ON CONFLICT (id) DO UPDATE SET
    code = EXCLUDED.code, name = EXCLUDED.name, display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active,
    bank_account_configuration = EXCLUDED.bank_account_configuration,
    receipt_configuration = EXCLUDED.receipt_configuration, updated_at = CURRENT_TIMESTAMP
  WHERE payment_methods.restaurant_id = EXCLUDED.restaurant_id
    AND payment_methods.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment method target is invalid' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.audit_events (
    actor_id, occurred_at, action, entity_type, entity_id,
    previous_values, new_values, source_ip
  ) VALUES (
    actor_user_id, (audit_event ->> 'occurredAt')::timestamptz,
    audit_event ->> 'action', audit_event ->> 'entityType', audit_event ->> 'entityId',
    audit_event -> 'previousValues', audit_event -> 'newValues',
    NULLIF(audit_event ->> 'sourceIp', '')::inet
  );
  RETURN QUERY SELECT * FROM public.payment_methods WHERE id = target_method_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_payment_method(
  uuid, uuid, uuid, text, text, integer, boolean, boolean,
  text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_payment_method(
  uuid, uuid, uuid, text, text, integer, boolean, boolean,
  text, text, text, text, text, text
) TO service_role;
