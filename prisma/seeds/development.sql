BEGIN;

-- Stable codes, rather than generated identifiers, are the public identity of
-- seeded authorization data. Existing identifiers are deliberately preserved
-- when a code already exists so this seed can be rerun against a used database.
INSERT INTO public.roles (id, code, name, description)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'administrator', 'Administrator', NULL),
  ('10000000-0000-4000-8000-000000000002', 'waiter', 'Waiter', NULL),
  ('10000000-0000-4000-8000-000000000003', 'kitchen_personnel', 'Kitchen Personnel', NULL)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;

-- PRD 10.2 permission catalog. The future refund capability is data only and
-- is intentionally not granted to an initial role by the PRD 10.3 matrix.
INSERT INTO public.permissions (id, code, name, description)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'orders.create', 'Create Orders', NULL),
  ('20000000-0000-4000-8000-000000000002', 'orders.edit', 'Edit Orders', NULL),
  ('20000000-0000-4000-8000-000000000003', 'orders.cancel', 'Cancel Orders', NULL),
  ('20000000-0000-4000-8000-000000000004', 'orders.view', 'View Orders', NULL),
  ('20000000-0000-4000-8000-000000000005', 'kitchen.queue.view', 'View Kitchen Queue', NULL),
  ('20000000-0000-4000-8000-000000000006', 'kitchen.ready.mark', 'Mark Ready', NULL),
  ('20000000-0000-4000-8000-000000000007', 'delivery.panel.view', 'View Delivery Panel', NULL),
  ('20000000-0000-4000-8000-000000000008', 'delivery.on_the_way.mark', 'Mark On the Way', NULL),
  ('20000000-0000-4000-8000-000000000009', 'delivery.delivered.mark', 'Mark Delivered', NULL),
  ('20000000-0000-4000-8000-000000000010', 'payments.register', 'Register Payment', NULL),
  ('20000000-0000-4000-8000-000000000011', 'payments.view', 'View Payments', NULL),
  ('20000000-0000-4000-8000-000000000012', 'payments.receipt.print', 'Print Receipt', NULL),
  ('20000000-0000-4000-8000-000000000013', 'payments.refund', 'Refund Payment (Future)', NULL),
  ('20000000-0000-4000-8000-000000000014', 'inventory.view', 'View Inventory', NULL),
  ('20000000-0000-4000-8000-000000000015', 'inventory.purchases.register', 'Register Purchases', NULL),
  ('20000000-0000-4000-8000-000000000016', 'inventory.adjustments.register', 'Register Adjustments', NULL),
  ('20000000-0000-4000-8000-000000000017', 'inventory.waste.register', 'Register Waste', NULL),
  ('20000000-0000-4000-8000-000000000018', 'production.batch.create', 'Create Production Batch', NULL),
  ('20000000-0000-4000-8000-000000000019', 'production.recipes.edit', 'Edit Recipes', NULL),
  ('20000000-0000-4000-8000-000000000020', 'production.history.view', 'View Production History', NULL),
  ('20000000-0000-4000-8000-000000000021', 'reports.view', 'View Reports', NULL),
  ('20000000-0000-4000-8000-000000000022', 'reports.export', 'Export Reports', NULL),
  ('20000000-0000-4000-8000-000000000023', 'administration.users.manage', 'Manage Users', NULL),
  ('20000000-0000-4000-8000-000000000024', 'administration.roles.manage', 'Manage Roles', NULL),
  ('20000000-0000-4000-8000-000000000025', 'administration.products.manage', 'Manage Products', NULL),
  ('20000000-0000-4000-8000-000000000026', 'administration.categories.manage', 'Manage Categories', NULL),
  ('20000000-0000-4000-8000-000000000027', 'administration.locations.manage', 'Manage Locations', NULL),
  ('20000000-0000-4000-8000-000000000028', 'administration.restaurant.configure', 'Configure Restaurant', NULL),
  ('20000000-0000-4000-8000-000000000029', 'administration.payment_methods.configure', 'Configure Payment Methods', NULL),
  ('20000000-0000-4000-8000-000000000030', 'administration.printers.configure', 'Configure Printers', NULL),
  ('20000000-0000-4000-8000-000000000031', 'audit.log.view', 'View Audit Log', NULL),
  ('20000000-0000-4000-8000-000000000032', 'administration.inventory.manage', 'Manage Inventory Items', 'Create, edit, activate, and deactivate inventory item definitions.'),
  ('20000000-0000-4000-8000-000000000033', 'payments.overage.authorize', 'Authorize Payment Overage', 'Authorize a payment above the selected basket outstanding balance with a recorded reason.')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;

-- Reconcile the three initial roles to the grants in PRD 10.3 plus the
-- explicitly approved business configuration grants. The
-- different wording in the matrix (for example, "Register Payments") maps to
-- the canonical permission from PRD 10.2 ("Register Payment") by stable code.
CREATE TEMPORARY TABLE seed_desired_role_permissions (
  role_code text NOT NULL,
  permission_code text NOT NULL,
  PRIMARY KEY (role_code, permission_code)
) ON COMMIT DROP;

INSERT INTO seed_desired_role_permissions (role_code, permission_code)
VALUES
  ('administrator', 'orders.create'),
  ('administrator', 'orders.edit'),
  ('administrator', 'orders.cancel'),
  ('administrator', 'orders.view'),
  ('administrator', 'kitchen.queue.view'),
  ('administrator', 'kitchen.ready.mark'),
  ('administrator', 'delivery.panel.view'),
  ('administrator', 'delivery.on_the_way.mark'),
  ('administrator', 'delivery.delivered.mark'),
  ('administrator', 'payments.register'),
  ('administrator', 'payments.view'),
  ('administrator', 'payments.receipt.print'),
  ('administrator', 'payments.overage.authorize'),
  ('administrator', 'inventory.view'),
  ('administrator', 'administration.inventory.manage'),
  ('administrator', 'inventory.purchases.register'),
  ('administrator', 'inventory.waste.register'),
  ('administrator', 'inventory.adjustments.register'),
  ('administrator', 'production.batch.create'),
  ('administrator', 'production.recipes.edit'),
  ('administrator', 'reports.view'),
  ('administrator', 'reports.export'),
  ('administrator', 'administration.products.manage'),
  ('administrator', 'administration.users.manage'),
  ('administrator', 'administration.payment_methods.configure'),
  ('administrator', 'audit.log.view'),
  ('waiter', 'orders.create'),
  ('waiter', 'orders.edit'),
  ('waiter', 'orders.view'),
  ('waiter', 'delivery.panel.view'),
  ('waiter', 'delivery.on_the_way.mark'),
  ('waiter', 'delivery.delivered.mark'),
  ('waiter', 'payments.register'),
  ('waiter', 'payments.view'),
  ('waiter', 'payments.receipt.print'),
  ('kitchen_personnel', 'orders.view'),
  ('kitchen_personnel', 'kitchen.queue.view'),
  ('kitchen_personnel', 'kitchen.ready.mark');

DELETE FROM public.role_permissions AS role_permission
USING public.roles AS role, public.permissions AS permission
WHERE role_permission.role_id = role.id
  AND role_permission.permission_id = permission.id
  AND role.code IN ('administrator', 'waiter', 'kitchen_personnel')
  AND NOT EXISTS (
    SELECT 1
    FROM seed_desired_role_permissions AS desired
    WHERE desired.role_code = role.code
      AND desired.permission_code = permission.code
  );

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM seed_desired_role_permissions AS desired
JOIN public.roles AS role ON role.code = desired.role_code
JOIN public.permissions AS permission ON permission.code = desired.permission_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- T-003 approved development restaurant. Required but unapproved optional
-- configuration is represented neutrally: no service charge and no printing
-- behavior. No deployment secrets or bank account details are seeded.
INSERT INTO public.restaurants (id, name, is_active, deleted_at)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  'Carnales — Mexican Grill',
  true,
  NULL
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active,
  deleted_at = EXCLUDED.deleted_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO public.restaurant_configurations (
  restaurant_id,
  service_charge_rate,
  preparation_warning_threshold_minutes,
  preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes,
  delivery_critical_threshold_minutes,
  inventory_policy,
  printing_behavior,
  business_hours
)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  0.000000,
  5,
  7,
  6,
  8,
  '{"allowNegativeStock": false}'::jsonb,
  '{}'::jsonb,
  '{"daily": {"opensAt": "11:00", "closesAt": "22:00"}}'::jsonb
)
ON CONFLICT (restaurant_id) DO UPDATE
SET
  service_charge_rate = EXCLUDED.service_charge_rate,
  preparation_warning_threshold_minutes = EXCLUDED.preparation_warning_threshold_minutes,
  preparation_critical_threshold_minutes = EXCLUDED.preparation_critical_threshold_minutes,
  delivery_warning_threshold_minutes = EXCLUDED.delivery_warning_threshold_minutes,
  delivery_critical_threshold_minutes = EXCLUDED.delivery_critical_threshold_minutes,
  inventory_policy = EXCLUDED.inventory_policy,
  printing_behavior = EXCLUDED.printing_behavior,
  business_hours = EXCLUDED.business_hours,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO public.service_locations (
  id,
  restaurant_id,
  name,
  type,
  display_order,
  is_active,
  allows_multiple_active_orders,
  deleted_at
)
VALUES
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Table 1', 'TABLE', 1, true, false, NULL),
  ('31000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Table 2', 'TABLE', 2, true, false, NULL),
  ('31000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'Table 3', 'TABLE', 3, true, false, NULL),
  ('31000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', 'Table 4', 'TABLE', 4, true, false, NULL),
  ('31000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', 'Table 5', 'TABLE', 5, true, false, NULL),
  ('31000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 'Table 6', 'TABLE', 6, true, false, NULL),
  ('31000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', 'Table 7', 'TABLE', 7, true, false, NULL),
  ('31000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000001', 'Table 8', 'TABLE', 8, true, false, NULL),
  ('31000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000001', 'Table 9', 'TABLE', 9, true, false, NULL),
  ('31000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000001', 'Table 10', 'TABLE', 10, true, false, NULL),
  ('31000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000001', 'Table 11', 'TABLE', 11, true, false, NULL),
  ('31000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000001', 'Table 12', 'TABLE', 12, true, false, NULL),
  ('31000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000001', 'Table 13', 'TABLE', 13, true, false, NULL),
  ('31000000-0000-4000-8000-000000000014', '30000000-0000-4000-8000-000000000001', 'Table 14', 'TABLE', 14, true, false, NULL),
  ('31000000-0000-4000-8000-000000000015', '30000000-0000-4000-8000-000000000001', 'Table 15', 'TABLE', 15, true, false, NULL),
  ('31000000-0000-4000-8000-000000000016', '30000000-0000-4000-8000-000000000001', 'Dispatch Window', 'DISPATCH_WINDOW', 16, true, true, NULL)
ON CONFLICT (restaurant_id, name) DO UPDATE
SET
  type = EXCLUDED.type,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  allows_multiple_active_orders = EXCLUDED.allows_multiple_active_orders,
  deleted_at = EXCLUDED.deleted_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO public.payment_methods (
  id,
  restaurant_id,
  code,
  name,
  display_order,
  is_active,
  bank_account_configuration,
  receipt_configuration,
  deleted_at
)
VALUES
  ('32000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'cash', 'Cash', 1, true, NULL, NULL, NULL),
  ('32000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'deuna', 'DeUna', 2, true, '{"kind": "BANK_TRANSFER"}'::jsonb, NULL, NULL),
  ('32000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'jep_fast', 'JEP Fast', 3, true, '{"kind": "BANK_TRANSFER"}'::jsonb, NULL, NULL)
ON CONFLICT (restaurant_id, code) DO UPDATE
SET
  name = EXCLUDED.name,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  bank_account_configuration = EXCLUDED.bank_account_configuration,
  receipt_configuration = EXCLUDED.receipt_configuration,
  deleted_at = EXCLUDED.deleted_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO public.restaurant_tax_rates (
  id,
  restaurant_id,
  code,
  name,
  rate,
  is_active,
  deleted_at
)
VALUES (
  '33000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'iva_15',
  'IVA 15%',
  0.150000,
  true,
  NULL
)
ON CONFLICT (restaurant_id, code) DO UPDATE
SET
  name = EXCLUDED.name,
  rate = EXCLUDED.rate,
  is_active = EXCLUDED.is_active,
  deleted_at = EXCLUDED.deleted_at,
  updated_at = CURRENT_TIMESTAMP;

-- Force the deferred restaurant/configuration invariant to be checked before
-- reporting a successful seed run.
SET CONSTRAINTS ALL IMMEDIATE;

COMMIT;
