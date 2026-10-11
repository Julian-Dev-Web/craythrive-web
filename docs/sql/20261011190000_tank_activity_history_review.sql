-- REVIEW ONLY. Not applied. No new activity table or historical backfill.
-- The local actuator writes automation rows with anon access today. This
-- owner-checked read RPC avoids exposing that unrestricted table in new UI.
-- It does NOT secure the existing anonymous device endpoints. A coordinated
-- authenticated device gateway is still needed before revoking those grants.
BEGIN;
-- Applications and devices do not need DDL or table-wide TRUNCATE rights.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.control_logs, public.device_commands, public.tank_automation_logs FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_tank_automation_history(
 p_tank_id uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
 p_offset integer DEFAULT 0, p_limit integer DEFAULT 100
) RETURNS SETOF public.tank_automation_logs
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.tanks t WHERE t.id=p_tank_id AND t.user_id=auth.uid()
 ) THEN RAISE EXCEPTION 'Tank ownership required' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>100
  OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to)
 THEN RAISE EXCEPTION 'Invalid history range' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT a.* FROM public.tank_automation_logs a
 WHERE a.tank_id=p_tank_id AND a.user_id=auth.uid()
  AND (p_from IS NULL OR a.created_at>=p_from)
  AND (p_to IS NULL OR a.created_at<p_to)
 ORDER BY a.created_at DESC NULLS LAST,a.id DESC OFFSET p_offset LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.get_tank_automation_history(uuid,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_tank_automation_history(uuid,timestamptz,timestamptz,integer,integer) TO authenticated;

-- Restrictive SELECT policies intersect the current overly broad permissive
-- authenticated policies. They do not alter command writes/device safety.
CREATE POLICY activity_owner_read_guard ON public.control_logs
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
 user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.tanks t WHERE t.id=control_logs.tank_id AND t.user_id=auth.uid())
 );
CREATE POLICY activity_owner_read_guard ON public.device_commands
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
 user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.tanks t WHERE t.id::text=device_commands.tank_id AND t.user_id=auth.uid())
 );
CREATE INDEX IF NOT EXISTS activity_control_owner_tank_date ON public.control_logs(user_id,tank_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS activity_command_owner_tank_date ON public.device_commands(user_id,tank_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS activity_automation_owner_tank_date ON public.tank_automation_logs(user_id,tank_id,created_at DESC,id DESC);
COMMIT;
