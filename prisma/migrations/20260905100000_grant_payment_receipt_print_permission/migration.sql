-- Human-approved initial receipt policy: Administrator and Waiter receive the
-- stable permission; Kitchen Personnel is explicitly excluded. Custom-role
-- grants are deliberately left untouched.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.roles AS role
CROSS JOIN public.permissions AS permission
WHERE role.code IN ('administrator', 'waiter')
  AND permission.code = 'payments.receipt.print'
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM public.role_permissions AS role_permission
USING public.roles AS role, public.permissions AS permission
WHERE role_permission.role_id = role.id
  AND role_permission.permission_id = permission.id
  AND role.code = 'kitchen_personnel'
  AND permission.code = 'payments.receipt.print';
