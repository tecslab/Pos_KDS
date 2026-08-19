BEGIN;

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '14000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  't014-rollback-probe@example.invalid',
  '',
  CURRENT_TIMESTAMP,
  '{}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO public.roles (id, code, name)
VALUES (
  '14000000-0000-4000-8000-000000000002',
  't014-probe-role',
  'T-014 Probe Role'
);

INSERT INTO public.application_users (id, display_name, is_active)
VALUES (
  '14000000-0000-4000-8000-000000000001',
  'T-014 Probe User',
  true
);

INSERT INTO public.user_role_assignments (user_id, role_id)
VALUES (
  '14000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000002'
);

INSERT INTO public.restaurants (
  id,
  name,
  is_active,
  updated_at
) VALUES (
  '14000000-0000-4000-8000-000000000003',
  'T-014 Probe Restaurant',
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.restaurant_configurations (
  restaurant_id,
  service_charge_rate,
  preparation_warning_threshold_minutes,
  preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes,
  delivery_critical_threshold_minutes,
  inventory_policy,
  printing_behavior,
  business_hours,
  updated_at
) VALUES (
  '14000000-0000-4000-8000-000000000003',
  0,
  5,
  7,
  6,
  8,
  '{"allowNegativeStock": false}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP
);

INSERT INTO public.inventory_items (
  id,
  restaurant_id,
  name,
  type,
  unit_of_measure,
  minimum_stock_level,
  is_active,
  updated_at
) VALUES (
  '14000000-0000-4000-8000-000000000004',
  '14000000-0000-4000-8000-000000000003',
  'T-014 Probe Item',
  'RAW_INGREDIENT',
  'unit',
  0,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO public.inventory_movements (
  id,
  restaurant_id,
  inventory_item_id,
  type,
  quantity_delta,
  unit_of_measure,
  recorded_by_id,
  recorded_at,
  business_origin_type,
  business_origin_id
) VALUES (
  '14000000-0000-4000-8000-000000000005',
  '14000000-0000-4000-8000-000000000003',
  '14000000-0000-4000-8000-000000000004',
  'PURCHASE',
  2,
  'unit',
  '14000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP - INTERVAL '1 minute',
  'PURCHASE',
  '14000000-0000-4000-8000-000000000006'
);

DO $probe$
BEGIN
  BEGIN
    INSERT INTO public.inventory_movements (
      id,
      restaurant_id,
      inventory_item_id,
      type,
      quantity_delta,
      unit_of_measure,
      recorded_by_id,
      recorded_at,
      business_origin_type,
      business_origin_id,
      reversed_movement_id
    ) VALUES (
      '14000000-0000-4000-8000-000000000007',
      '14000000-0000-4000-8000-000000000003',
      '14000000-0000-4000-8000-000000000004',
      'ROLLBACK',
      -2,
      'unit',
      '14000000-0000-4000-8000-000000000001',
      CURRENT_TIMESTAMP,
      'ROLLBACK',
      '14000000-0000-4000-8000-000000000008',
      NULL
    );
    RAISE EXCEPTION 'negative probe failed: rollback without a reference was accepted';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$probe$;

INSERT INTO public.inventory_movements (
  id,
  restaurant_id,
  inventory_item_id,
  type,
  quantity_delta,
  unit_of_measure,
  recorded_by_id,
  recorded_at,
  business_origin_type,
  business_origin_id,
  reversed_movement_id
) VALUES (
  '14000000-0000-4000-8000-000000000009',
  '14000000-0000-4000-8000-000000000003',
  '14000000-0000-4000-8000-000000000004',
  'ROLLBACK',
  -2,
  'unit',
  '14000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP,
  'ROLLBACK',
  '14000000-0000-4000-8000-000000000010',
  '14000000-0000-4000-8000-000000000005'
);

DO $probe$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements
    WHERE id = '14000000-0000-4000-8000-000000000009'
      AND reversed_movement_id = '14000000-0000-4000-8000-000000000005'
  ) THEN
    RAISE EXCEPTION 'positive probe failed: valid rollback was not recorded';
  END IF;
END;
$probe$;

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
