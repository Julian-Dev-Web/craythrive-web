-- Apply this migration independently after review. No rows are backfilled and
-- no water settings, existing grants/RLS policies or device writers are changed.
BEGIN;
ALTER TABLE public.tank_automation_settings
 ADD COLUMN IF NOT EXISTS auto_feeding_enabled boolean DEFAULT true,
 ADD COLUMN IF NOT EXISTS auto_feed_hour smallint DEFAULT 19,
 ADD COLUMN IF NOT EXISTS auto_feed_minute smallint DEFAULT 0,
 ADD COLUMN IF NOT EXISTS auto_feed_cycles smallint DEFAULT 2;

-- The linked project's zero-row REST check already found all four columns.
-- Check types/data rather than coercing or rewriting a conflicting installation.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT * FROM (VALUES ('auto_feeding_enabled','bool'),('auto_feed_hour','integer'),
  ('auto_feed_minute','integer'),('auto_feed_cycles','integer')) v(column_name,kind) LOOP
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
   AND c.table_name='tank_automation_settings' AND c.column_name=item.column_name
   AND (item.kind='bool' AND c.data_type='boolean' OR item.kind='integer' AND c.data_type IN ('smallint','integer'))) THEN
   RAISE EXCEPTION 'Review incompatible feeding field type: %',item.column_name;
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM public.tank_automation_settings WHERE auto_feeding_enabled IS NULL
   OR auto_feed_hour IS NULL OR auto_feed_hour NOT BETWEEN 0 AND 23
   OR auto_feed_minute IS NULL OR auto_feed_minute NOT BETWEEN 0 AND 59
   OR auto_feed_cycles IS NULL OR auto_feed_cycles NOT BETWEEN 1 AND 3) THEN
  RAISE EXCEPTION 'Review invalid existing feeding settings before migration; no rows were changed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tank_automation_settings'::regclass AND conname='craythrive_feeding_schedule_values') THEN
  ALTER TABLE public.tank_automation_settings ADD CONSTRAINT craythrive_feeding_schedule_values CHECK (
   auto_feeding_enabled IS NOT NULL AND auto_feed_hour IS NOT NULL AND auto_feed_hour BETWEEN 0 AND 23
   AND auto_feed_minute IS NOT NULL AND auto_feed_minute BETWEEN 0 AND 59
   AND auto_feed_cycles IS NOT NULL AND auto_feed_cycles BETWEEN 1 AND 3);
 END IF;
END $$;
ALTER TABLE public.tank_automation_settings
 ALTER COLUMN auto_feeding_enabled SET DEFAULT true, ALTER COLUMN auto_feed_hour SET DEFAULT 19,
 ALTER COLUMN auto_feed_minute SET DEFAULT 0, ALTER COLUMN auto_feed_cycles SET DEFAULT 2;

-- INVOKER retains existing RLS. These functions introduce no device/anon grant.
-- CREATE (not REPLACE) deliberately refuses to overwrite an unknown RPC.
CREATE FUNCTION public.get_tank_feeding_schedule(p_tank_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid=auth.uid(); owned public.tanks; settings public.tank_automation_settings;
 row_count integer; actuator_uid text; actuator_uids text[];
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO owned FROM public.tanks WHERE id=p_tank_id AND user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tank ownership required' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO row_count FROM public.tank_automation_settings WHERE user_id=actor AND tank_id=p_tank_id;
 IF row_count>1 THEN RAISE EXCEPTION 'Ambiguous automation settings: review duplicate rows for this tank' USING ERRCODE='21000'; END IF;
 SELECT * INTO settings FROM public.tank_automation_settings WHERE user_id=actor AND tank_id=p_tank_id;
 SELECT array_agg(d.device_uid ORDER BY d.device_uid) INTO actuator_uids FROM public.iot_devices d WHERE d.user_id=actor
  AND d.device_type='actuator_hub' AND d.is_claimed=true
  AND (d.tank_id::text=p_tank_id::text OR (nullif(d.tank_id::text,'') IS NULL
   AND d.device_uid=coalesce(nullif(to_jsonb(owned)->>'actuator_device_uid',''),nullif(to_jsonb(owned)->>'actuator_uid',''),nullif(to_jsonb(owned)->>'actuator_device',''))))
  ;
 IF cardinality(actuator_uids)>1 THEN
  actuator_uid=coalesce(nullif(to_jsonb(owned)->>'actuator_device_uid',''),nullif(to_jsonb(owned)->>'actuator_uid',''),nullif(to_jsonb(owned)->>'actuator_device',''));
  IF actuator_uid IS NULL OR NOT actuator_uid=ANY(actuator_uids) THEN
   RAISE EXCEPTION 'Ambiguous actuator pairing for this tank' USING ERRCODE='21000';
  END IF;
 ELSE actuator_uid=actuator_uids[1]; END IF;
 RETURN jsonb_build_object('tank_id',p_tank_id,'exists',row_count=1,'can_save',row_count=1 OR actuator_uid IS NOT NULL,
  'settings',CASE WHEN row_count=1 THEN jsonb_build_object('auto_feeding_enabled',settings.auto_feeding_enabled,
   'auto_feed_hour',settings.auto_feed_hour,'auto_feed_minute',settings.auto_feed_minute,'auto_feed_cycles',settings.auto_feed_cycles) ELSE NULL END,
  'actuator_uid',actuator_uid);
END $$;

CREATE FUNCTION public.save_tank_feeding_schedule(p_tank_id uuid,p_enabled boolean,p_hour integer,p_minute integer,p_cycles integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid=auth.uid(); snapshot jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_enabled IS NULL OR p_hour IS NULL OR p_hour NOT BETWEEN 0 AND 23 OR p_minute IS NULL OR p_minute NOT BETWEEN 0 AND 59
  OR p_cycles IS NULL OR p_cycles NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Invalid feeding schedule' USING ERRCODE='22023'; END IF;
 -- Lock the already-owned tank, including first insert when there is no unique
 -- tank_id constraint. Never assume an ON CONFLICT target or delete duplicates.
 PERFORM 1 FROM public.tanks WHERE id=p_tank_id AND user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tank ownership required' USING ERRCODE='42501'; END IF;
 snapshot=public.get_tank_feeding_schedule(p_tank_id);
 IF (snapshot->>'exists')::boolean THEN
  UPDATE public.tank_automation_settings SET auto_feeding_enabled=p_enabled,auto_feed_hour=p_hour,
   auto_feed_minute=p_minute,auto_feed_cycles=p_cycles WHERE user_id=actor AND tank_id=p_tank_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settings update was not permitted' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT (snapshot->>'can_save')::boolean THEN RAISE EXCEPTION 'Pair an actuator before saving the first schedule' USING ERRCODE='22023'; END IF;
  INSERT INTO public.tank_automation_settings(user_id,tank_id,device_uid,auto_feeding_enabled,auto_feed_hour,auto_feed_minute,auto_feed_cycles)
  VALUES(actor,p_tank_id,snapshot->>'actuator_uid',p_enabled,p_hour,p_minute,p_cycles);
 END IF;
 RETURN public.get_tank_feeding_schedule(p_tank_id);
END $$;
REVOKE ALL ON FUNCTION public.get_tank_feeding_schedule(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_tank_feeding_schedule(uuid,boolean,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_tank_feeding_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_tank_feeding_schedule(uuid,boolean,integer,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
