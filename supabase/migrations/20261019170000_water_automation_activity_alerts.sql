-- Activity reads and durable notifications only. No actuator/queue/mirror rule,
-- sensor history, threshold, timing, cooldown, RLS policy or device grant changes.
-- No historical backfill: existing logs are read immediately by the Activity UI.
BEGIN;
DO $preflight$
BEGIN
  IF to_regprocedure('public.create_alert_if_enabled(uuid,uuid,text,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Existing notification preference helper is required; review alert setup before applying';
  END IF;
END $preflight$;

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
 WHERE a.tank_id=p_tank_id AND (a.user_id=auth.uid() OR a.user_id IS NULL)
   AND (p_from IS NULL OR a.created_at>=p_from) AND (p_to IS NULL OR a.created_at<p_to)
 ORDER BY a.created_at DESC NULLS LAST,a.id DESC OFFSET p_offset LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.get_tank_automation_history(uuid,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_tank_automation_history(uuid,timestamptz,timestamptz,integer,integer) TO authenticated;
CREATE INDEX IF NOT EXISTS craythrive_automation_tank_activity_date
 ON public.tank_automation_logs(tank_id,created_at DESC,id DESC);

-- Only new canonical alerts participate; do not delete/rewrite older duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS craythrive_water_automation_alert_once
 ON public.alerts ((metadata->>'tank_automation_log_id'))
 WHERE source='tank_automation_logs' AND metadata->>'water_activity_version'='1';

CREATE OR REPLACE FUNCTION public.craythrive_water_activity_alert_payload(record jsonb, tank_name text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  action text := upper(coalesce(record->>'action_type',''));
  state text := lower(coalesce(record->>'action_status',''));
  label text;
  description text;
  reason text := nullif(btrim(record->>'reason'),'');
BEGIN
  IF action NOT IN ('AUTO_REFILL','AUTO_DRAIN') OR state NOT IN ('done','completed','failed','blocked','rejected') THEN RETURN NULL; END IF;
  label := CASE WHEN action='AUTO_REFILL' THEN 'Automatic Water Refill' ELSE 'Automatic Water Drain' END;
  description := coalesce(nullif(tank_name,''),'Tank') || CASE WHEN action='AUTO_REFILL'
    THEN ' automatically added water to correct the water level.' ELSE ' automatically drained water to correct the water level.' END;
  IF state='failed' THEN
    label := label || ' Failed'; description := coalesce(nullif(tank_name,''),'Tank') || ': the automatic water action could not be completed.';
  ELSIF state IN ('blocked','rejected') THEN
    label := label || ' Blocked'; description := coalesce(nullif(tank_name,''),'Tank') || ': the automatic water action was blocked by a safety rule.';
  ELSE label := label || ' Completed'; END IF;
  RETURN jsonb_build_object('title',label,'message',description || CASE WHEN reason IS NOT NULL THEN E'\nRecorded reason: ' || reason ELSE '' END,
    'severity',CASE WHEN state='failed' THEN 'critical' WHEN state IN ('blocked','rejected') THEN 'warning' ELSE 'normal' END,
    'metadata',jsonb_build_object('water_activity_version',1,'tank_automation_log_id',record->>'id',
      'action_type',action,'action_status',state,'reason',record->>'reason','device_uid',record->>'device_uid',
      'water_status',record->>'water_status','ph_status',record->>'ph_status','turbidity_status',record->>'turbidity_status',
      'temperature_status',record->>'temperature_status','ammonia_status',record->>'ammonia_status',
      'stable_reading_count',record->'stable_reading_count','duration_seconds',record->'duration_seconds','created_at',record->>'created_at'));
END; $$;

-- Normalize explicitly linked existing command/control mirror alerts too. This
-- lets the old pipeline and the direct log trigger share ONE persisted alert,
-- regardless of trigger execution order. Never deduplicate by time or type alone.
CREATE OR REPLACE FUNCTION public.craythrive_normalize_water_activity_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  reference text;
  command_reference text;
  evidence text;
  log_row public.tank_automation_logs%ROWTYPE;
  owner_id uuid;
  tank_name text;
  payload jsonb;
  existing_id uuid;
BEGIN
  IF new.type NOT IN ('actuator_command','control_log','water_automation')
    AND new.source IS DISTINCT FROM 'tank_automation_logs' THEN RETURN new; END IF;
  reference := coalesce(nullif(new.metadata->>'tank_automation_log_id',''),nullif(new.metadata->>'automation_log_id',''),nullif(new.metadata->>'auto_log_id',''));
  IF reference IS NULL THEN
    command_reference := coalesce(new.command_id::text,new.metadata->>'command_id');
    IF command_reference IS NOT NULL THEN
      SELECT c.result_message INTO evidence FROM public.device_commands c
      WHERE c.id::text=command_reference AND c.user_id=new.user_id AND c.tank_id::text=new.tank_id::text;
    END IF;
    evidence := coalesce(evidence,new.metadata->>'notes',new.metadata->>'result_message',new.message,'');
    reference := substring(evidence FROM 'Auto log id:[[:space:]]*([0-9a-fA-F-]{36})');
  END IF;
  IF reference IS NULL THEN RETURN new; END IF;
  SELECT a.* INTO log_row FROM public.tank_automation_logs a WHERE a.id::text=reference AND a.tank_id=new.tank_id;
  IF NOT FOUND OR log_row.action_type NOT IN ('AUTO_REFILL','AUTO_DRAIN') THEN RETURN new; END IF;
  SELECT t.user_id,coalesce(to_jsonb(t)->>'tank_name',to_jsonb(t)->>'name','Tank') INTO owner_id,tank_name
    FROM public.tanks t WHERE t.id=log_row.tank_id;
  IF owner_id IS NULL OR owner_id IS DISTINCT FROM new.user_id
    OR (log_row.user_id IS NOT NULL AND log_row.user_id IS DISTINCT FROM owner_id) THEN RETURN new; END IF;
  IF EXISTS(SELECT 1 FROM public.notification_preferences p WHERE p.user_id=owner_id AND p.pump_alerts=false) THEN RETURN NULL; END IF;
  payload := public.craythrive_water_activity_alert_payload(to_jsonb(log_row),tank_name);
  -- A legacy mirror's done flag cannot turn a rechecking/failed source into success.
  IF payload IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('craythrive-water-alert:' || log_row.id::text,0));
  SELECT a.id INTO existing_id FROM public.alerts a WHERE a.user_id=owner_id AND a.tank_id=log_row.tank_id
    AND a.type IN ('actuator_command','control_log','water_automation')
    AND (a.metadata->>'tank_automation_log_id'=reference OR a.metadata->>'automation_log_id'=reference OR a.metadata->>'auto_log_id'=reference
      OR substring(coalesce(a.metadata->>'notes',a.metadata->>'result_message',a.message,'') FROM 'Auto log id:[[:space:]]*([0-9a-fA-F-]{36})')=reference
      OR EXISTS(SELECT 1 FROM public.device_commands c WHERE c.id=a.command_id AND c.user_id=owner_id
        AND c.tank_id::text=log_row.tank_id::text AND substring(c.result_message FROM 'Auto log id:[[:space:]]*([0-9a-fA-F-]{36})')=reference))
    ORDER BY a.created_at,a.id LIMIT 1;
  IF existing_id IS NOT NULL THEN
    UPDATE public.alerts SET title=payload->>'title',message=payload->>'message',severity=payload->>'severity',
      source='tank_automation_logs',metadata=coalesce(metadata,'{}'::jsonb) || (payload->'metadata')
      WHERE id=existing_id AND (title IS DISTINCT FROM payload->>'title' OR message IS DISTINCT FROM payload->>'message'
        OR severity IS DISTINCT FROM payload->>'severity' OR metadata->>'action_status' IS DISTINCT FROM payload->'metadata'->>'action_status'
        OR metadata->>'water_activity_version' IS DISTINCT FROM '1' OR source IS DISTINCT FROM 'tank_automation_logs');
    RETURN NULL;
  END IF;
  new.title := payload->>'title'; new.message := payload->>'message'; new.severity := payload->>'severity';
  new.source := 'tank_automation_logs'; new.metadata := coalesce(new.metadata,'{}'::jsonb) || (payload->'metadata');
  new.device_uid := log_row.device_uid; new.created_at := log_row.created_at;
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Notification problems must never roll back a valid actuator history insert.
  RAISE WARNING 'CrayThrive water alert normalization failed (SQLSTATE %)',SQLSTATE;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.craythrive_notify_water_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_id uuid; tank_name text; payload jsonb;
BEGIN
  IF new.action_type NOT IN ('AUTO_REFILL','AUTO_DRAIN') THEN RETURN new; END IF;
  SELECT t.user_id,coalesce(to_jsonb(t)->>'tank_name',to_jsonb(t)->>'name','Tank') INTO owner_id,tank_name
    FROM public.tanks t WHERE t.id=new.tank_id;
  IF owner_id IS NULL OR (new.user_id IS NOT NULL AND new.user_id IS DISTINCT FROM owner_id) THEN RETURN new; END IF;
  payload := public.craythrive_water_activity_alert_payload(to_jsonb(new),tank_name);
  IF payload IS NULL THEN RETURN new; END IF;
  PERFORM public.create_alert_if_enabled(owner_id,new.tank_id,'pump_alerts','control_log',
    payload->>'title',payload->>'message',payload->>'severity',payload->'metadata');
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'CrayThrive water alert synchronization failed (SQLSTATE %)',SQLSTATE;
  RETURN new;
END; $$;
REVOKE ALL ON FUNCTION public.craythrive_water_activity_alert_payload(jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.craythrive_normalize_water_activity_alert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.craythrive_notify_water_activity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS craythrive_water_activity_alert_normalize ON public.alerts;
CREATE TRIGGER craythrive_water_activity_alert_normalize BEFORE INSERT ON public.alerts
 FOR EACH ROW EXECUTE FUNCTION public.craythrive_normalize_water_activity_alert();
DROP TRIGGER IF EXISTS craythrive_water_activity_notify ON public.tank_automation_logs;
CREATE TRIGGER craythrive_water_activity_notify AFTER INSERT OR UPDATE OF action_status ON public.tank_automation_logs
 FOR EACH ROW EXECUTE FUNCTION public.craythrive_notify_water_activity();
NOTIFY pgrst,'reload schema';
COMMIT;
