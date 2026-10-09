-- Approved compatibility bridge. Apply this exact migration independently.
-- Retains the original legacy table/UNIQUE(user_id) for the installed mobile APK.
-- No backfill and no legacy row updates occur during this migration.
BEGIN;
CREATE TABLE public.tank_threshold_settings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 tank_id uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
 thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
 temperature_min numeric NOT NULL DEFAULT 20, temperature_max numeric NOT NULL DEFAULT 30,
 ph_min numeric NOT NULL DEFAULT 6.5, ph_max numeric NOT NULL DEFAULT 8.5,
 turbidity_max numeric NOT NULL DEFAULT 2.5, water_level_min numeric NOT NULL DEFAULT 4.5,
 ammonia_max numeric NOT NULL DEFAULT 0.25,
 pending_ai_suggestion jsonb, pending_ai_suggested_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tank_threshold_settings_user_tank_key UNIQUE(user_id,tank_id)
);
ALTER TABLE public.tank_threshold_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tank_threshold_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.tank_threshold_settings TO authenticated;
CREATE POLICY tank_threshold_owner ON public.tank_threshold_settings FOR ALL TO authenticated
 USING (user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.tanks t WHERE t.id=tank_id AND t.user_id=auth.uid()))
 WITH CHECK (user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.tanks t WHERE t.id=tank_id AND t.user_id=auth.uid()));
ALTER TABLE public.control_logs ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE POLICY threshold_activity_read_guard ON public.control_logs AS RESTRICTIVE FOR SELECT TO authenticated
USING (action_type<>'threshold_updated' OR (user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.tanks t WHERE t.id=tank_id AND t.user_id=auth.uid())));
CREATE POLICY threshold_activity_insert_guard ON public.control_logs AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (action_type<>'threshold_updated');
CREATE POLICY threshold_activity_update_guard ON public.control_logs AS RESTRICTIVE FOR UPDATE TO authenticated
USING (action_type<>'threshold_updated') WITH CHECK (action_type<>'threshold_updated');
CREATE POLICY threshold_activity_delete_guard ON public.control_logs AS RESTRICTIVE FOR DELETE TO authenticated USING (action_type<>'threshold_updated');

-- Same normalization/defaults as Web, including older JSON + flat-column rows.
CREATE FUNCTION public.craythrive_threshold_values(p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb='{}'; item record; candidate jsonb; number_value numeric;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('temperatureMin','temperature_min',20::numeric),('temperatureMax','temperature_max',30::numeric),
  ('phMin','ph_min',6.5::numeric),('phMax','ph_max',8.5::numeric),('turbidityMax','turbidity_max',2.5::numeric),
  ('waterLevelMin','water_level_min',4.5::numeric),('ammoniaMax','ammonia_max',0.25::numeric)
 ) AS v(key,column_name,fallback) LOOP
  candidate=coalesce(nullif(p_row->'thresholds'->item.key,'null'),nullif(p_row->'thresholds'->item.column_name,'null'),p_row->item.column_name);
  number_value=item.fallback;
  IF jsonb_typeof(candidate) IN ('number','string') AND (candidate #>> '{}') ~ '^\s*[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?\s*$' THEN
    number_value=(candidate #>> '{}')::numeric;
  END IF;
  result=result||jsonb_build_object(item.key,number_value);
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION public.craythrive_ai_threshold_patch(s jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE parameter text=replace(lower(s->>'parameter'),'_',''); minimum jsonb; maximum jsonb; value jsonb;
BEGIN
 minimum=coalesce(s->'suggested_min',s#>'{suggested,min}');
 maximum=coalesce(s->'suggested_max',s#>'{suggested,max}');
 value=coalesce(s->'suggested_value',s#>'{suggested,value}',CASE WHEN jsonb_typeof(s->'suggested')='number' THEN s->'suggested' END,minimum,maximum);
 IF parameter='temperature' THEN RETURN jsonb_build_object('temperatureMin',minimum,'temperatureMax',maximum);
 ELSIF parameter='ph' THEN RETURN jsonb_build_object('phMin',minimum,'phMax',maximum);
 ELSIF parameter IN ('waterlevel','waterlevelmin','waterdepth') THEN RETURN jsonb_build_object('waterLevelMin',value);
 ELSIF parameter IN ('turbidity','turbiditymax') THEN RETURN jsonb_build_object('turbidityMax',value);
 ELSIF parameter IN ('ammonia','ammoniamax') THEN RETURN jsonb_build_object('ammoniaMax',coalesce(s->'suggested_value',s#>'{suggested,value}',maximum,minimum,value));
 END IF;
 RAISE EXCEPTION 'Unsupported AI threshold recommendation';
END $$;

-- Every actual value change is audited, including direct authenticated writes.
CREATE FUNCTION public.craythrive_audit_threshold_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_values jsonb; after_values jsonb; baseline jsonb; changes text[]='{}'; item record;
 source_value text; scope_value text;
BEGIN
 IF NEW.tank_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tanks WHERE id=NEW.tank_id AND user_id=NEW.user_id) THEN
  RAISE EXCEPTION 'Tank ownership required' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.tank_id IS DISTINCT FROM NEW.tank_id THEN
   RAISE EXCEPTION 'Threshold identity cannot be changed' USING ERRCODE='42501';
  END IF;
  before_values=public.craythrive_threshold_values(to_jsonb(OLD));
 ELSE
  SELECT to_jsonb(s) INTO baseline FROM public.threshold_settings s WHERE user_id=NEW.user_id;
  before_values=public.craythrive_threshold_values(baseline);
 END IF;
 -- Legacy writes have no tank attribution. Administrative/backfill writes with
 -- no authenticated actor are not user actions and must not fabricate activity.
 IF NEW.tank_id IS NULL OR auth.uid() IS NULL THEN RETURN NEW; END IF;
 after_values=public.craythrive_threshold_values(to_jsonb(NEW));
 IF before_values=after_values THEN RETURN NEW; END IF;
 source_value=CASE WHEN current_setting('craythrive.threshold_source',true)='ai_recommendation' THEN 'ai_recommendation' ELSE 'manual' END;
 scope_value=CASE WHEN current_setting('craythrive.threshold_scope',true)='all_tanks' THEN 'all_tanks' ELSE 'single_tank' END;
 FOR item IN SELECT * FROM (VALUES
  ('temperatureMin','Temperature Minimum',' °C'),('temperatureMax','Temperature Maximum',' °C'),
  ('phMin','pH Minimum',''),('phMax','pH Maximum',''),('turbidityMax','Water Clarity Minimum',' V'),
  ('waterLevelMin','Water Level Minimum',' cm'),('ammoniaMax','Ammonia Maximum',' mg/L')
 ) AS v(key,label,unit) LOOP
  IF before_values->item.key IS DISTINCT FROM after_values->item.key THEN
   changes=array_append(changes,item.label||': '||(before_values->>item.key)||item.unit||' → '||(after_values->>item.key)||item.unit);
  END IF;
 END LOOP;
 INSERT INTO public.control_logs(user_id,tank_id,action_type,action_status,notes,metadata)
 VALUES(NEW.user_id,NEW.tank_id,'threshold_updated','updated',array_to_string(changes,E'\n')
  ||CASE WHEN source_value='ai_recommendation' THEN E'\nAI recommendation accepted by user.' ELSE '' END
  ||CASE WHEN scope_value='all_tanks' THEN E'\nApplied to all tanks.' ELSE '' END,
  jsonb_build_object('source',source_value,'scope',scope_value,'actor_user_id',auth.uid(),
   'old_values',before_values,'new_values',after_values));
 RETURN NEW;
END $$;
CREATE TRIGGER craythrive_threshold_audit AFTER INSERT OR UPDATE ON public.tank_threshold_settings
FOR EACH ROW EXECUTE FUNCTION public.craythrive_audit_threshold_change();

-- One transaction covers all owned tanks and corresponding audit rows. Caller
-- supplies no user id. RLS remains active (SECURITY INVOKER).
CREATE FUNCTION public.apply_tank_thresholds(p_tank_id uuid,p_patch jsonb,p_scope text DEFAULT 'single_tank',p_source text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE actor uuid=auth.uid(); target record; selected_row public.tank_threshold_settings; saved public.tank_threshold_settings;
 baseline jsonb; current_values jsonb; next_values jsonb; patch jsonb=p_patch; key text;
 result jsonb='[]'; affected integer=0; changed integer=0;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_scope IS NULL OR p_source IS NULL OR p_scope NOT IN ('single_tank','all_tanks') OR p_source NOT IN ('manual','ai_recommendation') THEN RAISE EXCEPTION 'Invalid threshold operation'; END IF;
 -- Serialize this owner's changes, including first inserts and apply-all.
 PERFORM pg_advisory_xact_lock(hashtextextended('craythrive:thresholds:'||actor::text,0));
 PERFORM 1 FROM public.tanks WHERE id=p_tank_id AND user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tank ownership required' USING ERRCODE='42501'; END IF;
 SELECT * INTO selected_row FROM public.tank_threshold_settings WHERE user_id=actor AND tank_id=p_tank_id FOR UPDATE;
 IF p_source='ai_recommendation' THEN
  IF selected_row.pending_ai_suggestion IS NULL THEN RAISE EXCEPTION 'No pending AI recommendation for this tank'; END IF;
  patch=public.craythrive_ai_threshold_patch(selected_row.pending_ai_suggestion);
 END IF;
 IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR patch='{}' THEN RAISE EXCEPTION 'No threshold changes supplied'; END IF;
 FOR key IN SELECT jsonb_object_keys(patch) LOOP
  IF key NOT IN ('temperatureMin','temperatureMax','phMin','phMax','turbidityMax','waterLevelMin','ammoniaMax')
     OR jsonb_typeof(patch->key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid threshold value: %',key; END IF;
 END LOOP;
 SELECT to_jsonb(s) INTO baseline FROM public.threshold_settings s WHERE user_id=actor;
 IF p_scope='all_tanks' THEN
  patch=public.craythrive_threshold_values(CASE WHEN selected_row.id IS NULL THEN baseline ELSE to_jsonb(selected_row) END)||patch;
 END IF;
 PERFORM set_config('craythrive.threshold_source',p_source,true);
 PERFORM set_config('craythrive.threshold_scope',p_scope,true);
 FOR target IN SELECT id FROM public.tanks WHERE user_id=actor AND (p_scope='all_tanks' OR id=p_tank_id) ORDER BY id FOR UPDATE LOOP
  SELECT * INTO saved FROM public.tank_threshold_settings WHERE user_id=actor AND tank_id=target.id FOR UPDATE;
  current_values=public.craythrive_threshold_values(CASE WHEN saved.id IS NULL THEN baseline ELSE to_jsonb(saved) END);
  next_values=current_values||patch;
  IF (next_values->>'temperatureMin')::numeric NOT BETWEEN 10 AND 40 OR (next_values->>'temperatureMax')::numeric NOT BETWEEN 10 AND 40
   OR (next_values->>'temperatureMin')::numeric >= (next_values->>'temperatureMax')::numeric
   OR (next_values->>'phMin')::numeric < 0 OR (next_values->>'phMax')::numeric > 14
   OR (next_values->>'phMin')::numeric >= (next_values->>'phMax')::numeric
   OR (next_values->>'turbidityMax')::numeric NOT BETWEEN 0 AND 5
   OR (next_values->>'waterLevelMin')::numeric NOT BETWEEN 0 AND 20
   OR (next_values->>'ammoniaMax')::numeric NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'Threshold values are outside supported limits'; END IF;
  IF next_values IS DISTINCT FROM current_values THEN changed=changed+1; END IF;
  INSERT INTO public.tank_threshold_settings(user_id,tank_id,thresholds,temperature_min,temperature_max,ph_min,ph_max,turbidity_max,water_level_min,ammonia_max)
  VALUES(actor,target.id,next_values,(next_values->>'temperatureMin')::numeric,(next_values->>'temperatureMax')::numeric,
   (next_values->>'phMin')::numeric,(next_values->>'phMax')::numeric,(next_values->>'turbidityMax')::numeric,
   (next_values->>'waterLevelMin')::numeric,(next_values->>'ammoniaMax')::numeric)
  ON CONFLICT (user_id,tank_id) DO UPDATE SET thresholds=excluded.thresholds,temperature_min=excluded.temperature_min,
   temperature_max=excluded.temperature_max,ph_min=excluded.ph_min,ph_max=excluded.ph_max,turbidity_max=excluded.turbidity_max,
   water_level_min=excluded.water_level_min,ammonia_max=excluded.ammonia_max,updated_at=now()
  RETURNING * INTO saved;
  result=result||jsonb_build_array(to_jsonb(saved)); affected=affected+1;
 END LOOP;
 -- Synchronize the account-wide baseline only for an explicit Apply All.
 -- Do this AFTER tank writes so insert audits compare with the old fallback.
 -- Preserve legacy identity, creation time and pending metadata; bump the
 -- update timestamp only when effective legacy values actually change.
 IF p_scope='all_tanks' THEN
  INSERT INTO public.threshold_settings(user_id,thresholds,temperature_min,temperature_max,ph_min,ph_max,turbidity_max,water_level_min,ammonia_max)
  VALUES(actor,next_values,(next_values->>'temperatureMin')::numeric,(next_values->>'temperatureMax')::numeric,
   (next_values->>'phMin')::numeric,(next_values->>'phMax')::numeric,(next_values->>'turbidityMax')::numeric,
   (next_values->>'waterLevelMin')::numeric,(next_values->>'ammoniaMax')::numeric)
  ON CONFLICT (user_id) DO UPDATE SET thresholds=threshold_settings.thresholds||excluded.thresholds,temperature_min=excluded.temperature_min,
   temperature_max=excluded.temperature_max,ph_min=excluded.ph_min,ph_max=excluded.ph_max,turbidity_max=excluded.turbidity_max,
   water_level_min=excluded.water_level_min,ammonia_max=excluded.ammonia_max,
   updated_at=CASE WHEN public.craythrive_threshold_values(to_jsonb(threshold_settings)) IS DISTINCT FROM next_values
    THEN now() ELSE threshold_settings.updated_at END;
 END IF;
 IF p_source='ai_recommendation' THEN
  UPDATE public.tank_threshold_settings SET pending_ai_suggestion=NULL,pending_ai_suggested_at=NULL WHERE user_id=actor AND tank_id=p_tank_id;
 END IF;
 PERFORM set_config('craythrive.threshold_source','',true);
 PERFORM set_config('craythrive.threshold_scope','',true);
 RETURN jsonb_build_object('affected',affected,'changed',changed,'rows',result);
END $$;
REVOKE ALL ON FUNCTION public.apply_tank_thresholds(uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_tank_thresholds(uuid,jsonb,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.craythrive_audit_threshold_change() FROM PUBLIC,anon,authenticated;

-- New clients read a logical collection while old clients continue reading their
-- single original table row. The caller JWT and both tables' RLS remain active.
CREATE FUNCTION public.get_tank_threshold_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(r.row ORDER BY r.tank_id NULLS FIRST),'[]'::jsonb)
 FROM (
  SELECT to_jsonb(s)||jsonb_build_object('tank_id',NULL) AS row,NULL::uuid AS tank_id FROM public.threshold_settings s WHERE s.user_id=auth.uid()
  UNION ALL
  SELECT to_jsonb(s),s.tank_id FROM public.tank_threshold_settings s WHERE s.user_id=auth.uid()
 ) r;
$$;
REVOKE ALL ON FUNCTION public.get_tank_threshold_settings() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_tank_threshold_settings() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
