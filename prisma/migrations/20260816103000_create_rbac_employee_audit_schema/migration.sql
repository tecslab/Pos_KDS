CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.application_users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_users_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT application_users_auth_user_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT roles_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT roles_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT permissions_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT permissions_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE public.user_role_assignments (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_role_assignments_user_fkey
    FOREIGN KEY (user_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_role_assignments_role_fkey
    FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX user_role_assignments_role_id_idx ON public.user_role_assignments(role_id);

CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_fkey
    FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT role_permissions_permission_fkey
    FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX role_permissions_permission_id_idx ON public.role_permissions(permission_id);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  previous_values jsonb,
  new_values jsonb,
  source_ip inet,
  CONSTRAINT audit_events_actor_fkey
    FOREIGN KEY (actor_id) REFERENCES public.application_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT audit_events_action_not_blank CHECK (btrim(action) <> ''),
  CONSTRAINT audit_events_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
  CONSTRAINT audit_events_entity_id_not_blank CHECK (btrim(entity_id) <> '')
);

CREATE INDEX audit_events_occurred_at_idx ON public.audit_events(occurred_at);
CREATE INDEX audit_events_actor_id_occurred_at_idx ON public.audit_events(actor_id, occurred_at);
CREATE INDEX audit_events_entity_type_entity_id_occurred_at_idx
  ON public.audit_events(entity_type, entity_id, occurred_at);

CREATE FUNCTION public.assert_application_user_has_role(user_id_to_check uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.application_users WHERE id = user_id_to_check)
    AND NOT EXISTS (SELECT 1 FROM public.user_role_assignments WHERE user_id = user_id_to_check) THEN
    RAISE EXCEPTION 'application user % must retain at least one role', user_id_to_check
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_new_application_user_has_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_application_user_has_role(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER application_users_require_role
AFTER INSERT ON public.application_users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_new_application_user_has_role();

CREATE FUNCTION public.assert_assignment_removal_keeps_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_application_user_has_role(OLD.user_id);
  IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
    PERFORM public.assert_application_user_has_role(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_role_assignments_preserve_role_on_delete
AFTER DELETE ON public.user_role_assignments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_assignment_removal_keeps_role();

CREATE CONSTRAINT TRIGGER user_role_assignments_preserve_role_on_user_change
AFTER UPDATE OF user_id ON public.user_role_assignments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_assignment_removal_keeps_role();

CREATE FUNCTION public.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_event_mutation();

ALTER TABLE public.application_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
