CREATE OR REPLACE FUNCTION public.replace_application_user_roles(
  target_user_id uuid,
  target_display_name text,
  desired_role_ids uuid[]
)
RETURNS TABLE (previous_role_ids uuid[], assigned_role_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_role_ids uuid[];
  existing_role_count integer;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user is required' USING ERRCODE = '22023';
  END IF;

  IF target_display_name IS NULL OR btrim(target_display_name) = '' THEN
    RAISE EXCEPTION 'target display name is required' USING ERRCODE = '22023';
  END IF;

  IF desired_role_ids IS NULL OR cardinality(desired_role_ids) = 0
    OR array_position(desired_role_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'at least one role is required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(role_id ORDER BY role_id), count(*)
  INTO normalized_role_ids, existing_role_count
  FROM (
    SELECT DISTINCT requested_role_id AS role_id
    FROM unnest(desired_role_ids) AS requested_role_id
  ) AS requested_roles;

  IF cardinality(normalized_role_ids) <> cardinality(desired_role_ids) THEN
    RAISE EXCEPTION 'role identifiers must be unique' USING ERRCODE = '22023';
  END IF;

  -- Serialize assignments for the same auth subject even before its application
  -- profile exists. Role locks make deletion/replacement of reference data safe.
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0));
  PERFORM 1
  FROM public.roles
  WHERE id = ANY(normalized_role_ids)
  ORDER BY id
  FOR KEY SHARE;

  GET DIAGNOSTICS existing_role_count = ROW_COUNT;
  IF existing_role_count <> cardinality(normalized_role_ids) THEN
    RAISE EXCEPTION 'one or more roles do not exist' USING ERRCODE = '23503';
  END IF;

  PERFORM 1
  FROM public.application_users
  WHERE id = target_user_id
  FOR UPDATE;

  INSERT INTO public.application_users (id, display_name)
  VALUES (target_user_id, btrim(target_display_name))
  ON CONFLICT (id) DO NOTHING;

  SELECT COALESCE(array_agg(role_id ORDER BY role_id), ARRAY[]::uuid[])
  INTO previous_role_ids
  FROM public.user_role_assignments
  WHERE user_id = target_user_id;

  DELETE FROM public.user_role_assignments
  WHERE user_id = target_user_id
    AND NOT (role_id = ANY(normalized_role_ids));

  INSERT INTO public.user_role_assignments (user_id, role_id)
  SELECT target_user_id, requested_role_id
  FROM unnest(normalized_role_ids) AS requested_role_id
  ON CONFLICT (user_id, role_id) DO NOTHING;

  assigned_role_ids := normalized_role_ids;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_application_user_roles(uuid, text, uuid[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_application_user_roles(uuid, text, uuid[])
TO service_role;
