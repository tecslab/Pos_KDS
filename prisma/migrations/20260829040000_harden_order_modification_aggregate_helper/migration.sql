REVOKE ALL ON FUNCTION public.order_active_aggregate_json(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_active_aggregate_json(uuid)
  TO service_role;
