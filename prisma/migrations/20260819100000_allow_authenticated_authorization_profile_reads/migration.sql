-- Authenticated employees may read only the persisted role-permission graph
-- assigned to their own auth subject. No write policy or privilege statement exists.

CREATE POLICY application_users_select_self
ON public.application_users
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY user_role_assignments_select_self
ON public.user_role_assignments
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY roles_select_assigned_to_self
ON public.roles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_role_assignments AS current_user_role
    WHERE current_user_role.user_id = (SELECT auth.uid())
      AND current_user_role.role_id = roles.id
  )
);

CREATE POLICY role_permissions_select_assigned_to_self
ON public.role_permissions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_role_assignments AS current_user_role
    WHERE current_user_role.user_id = (SELECT auth.uid())
      AND current_user_role.role_id = role_permissions.role_id
  )
);

CREATE POLICY permissions_select_granted_to_self
ON public.permissions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.role_permissions AS assigned_grant
    INNER JOIN public.user_role_assignments AS current_user_role
      ON current_user_role.role_id = assigned_grant.role_id
    WHERE current_user_role.user_id = (SELECT auth.uid())
      AND assigned_grant.permission_id = permissions.id
  )
);
