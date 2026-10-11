BEGIN;
-- Read-only authenticated clock. No row rewrite, timezone setting, new table,
-- actuator change or RLS bypass. Qualified built-in and fixed search path.
CREATE FUNCTION public.craythrive_server_time() RETURNS timestamptz
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT pg_catalog.clock_timestamp(); $$;
REVOKE ALL ON FUNCTION public.craythrive_server_time() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.craythrive_server_time() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
