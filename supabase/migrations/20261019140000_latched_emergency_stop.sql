-- STOP_ALL remains the existing command. Resume is an explicit device command,
-- never a browser-only unlock. No historical commands or safety settings reset.
BEGIN;
DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.device_commands'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) ~ 'command_type') THEN
  RAISE EXCEPTION 'Review command_type CHECK constraints for STOP_ALL, RESUME_CONTROLS and RESET_FEED_LOCK before deployment'; END IF;
END $preflight$;
ALTER TABLE public.tank_automation_settings
 ADD COLUMN IF NOT EXISTS emergency_stop_active boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS emergency_stop_command_id uuid,
 ADD COLUMN IF NOT EXISTS emergency_stop_applied_at timestamptz,
 ADD COLUMN IF NOT EXISTS emergency_resume_command_id uuid,
 ADD COLUMN IF NOT EXISTS emergency_stop_generation bigint NOT NULL DEFAULT 0;

CREATE FUNCTION public.craythrive_emergency_owner(p_tank_id uuid,p_device_uid text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid=auth.uid();
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.tanks WHERE id=p_tank_id AND user_id=actor)
  OR NOT EXISTS(SELECT 1 FROM public.iot_devices d WHERE d.user_id=actor AND d.device_uid=p_device_uid
   AND d.device_type='actuator_hub' AND d.is_claimed=true AND (d.tank_id::text=p_tank_id::text OR
    (d.tank_id IS NULL AND EXISTS(SELECT 1 FROM public.tanks t WHERE t.id=p_tank_id AND
     p_device_uid=coalesce(nullif(to_jsonb(t)->>'actuator_device_uid',''),nullif(to_jsonb(t)->>'actuator_uid',''),nullif(to_jsonb(t)->>'actuator_device',''))))))
 THEN RAISE EXCEPTION 'Owned paired actuator required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

-- Existing settings writes remain valid, but clients cannot forge/unlatch the
-- emergency state through the feeding/water settings table.
CREATE FUNCTION public.craythrive_protect_emergency_settings() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
  IF TG_OP='DELETE' THEN
   IF OLD.emergency_stop_active THEN RAISE EXCEPTION 'Resume controls before removing latched settings' USING ERRCODE='42501'; END IF;
   RETURN OLD;
  ELSIF TG_OP='INSERT' THEN
   IF NEW.emergency_stop_active OR NEW.emergency_stop_command_id IS NOT NULL OR NEW.emergency_resume_command_id IS NOT NULL
    OR NEW.emergency_stop_applied_at IS NOT NULL OR NEW.emergency_stop_generation<>0 THEN
    RAISE EXCEPTION 'Use the emergency control command flow' USING ERRCODE='42501'; END IF;
  ELSIF ROW(NEW.emergency_stop_active,NEW.emergency_stop_command_id,NEW.emergency_stop_applied_at,NEW.emergency_resume_command_id,NEW.emergency_stop_generation)
   IS DISTINCT FROM ROW(OLD.emergency_stop_active,OLD.emergency_stop_command_id,OLD.emergency_stop_applied_at,OLD.emergency_resume_command_id,OLD.emergency_stop_generation) THEN
   RAISE EXCEPTION 'Use the emergency control command flow' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER craythrive_protect_emergency_settings BEFORE INSERT OR UPDATE OR DELETE ON public.tank_automation_settings
 FOR EACH ROW EXECUTE FUNCTION public.craythrive_protect_emergency_settings();

CREATE FUNCTION public.craythrive_guard_actuator_queue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected_tank uuid; latched boolean; actor uuid; normal boolean;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.user_id,NEW.tank_id,NEW.device_uid,NEW.command_type)
  IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.tank_id,OLD.device_uid,OLD.command_type) THEN
  RAISE EXCEPTION 'Command identity and actuator scope are immutable' USING ERRCODE='42501'; END IF;
 normal=NEW.command_type IN ('RESET_FEED_LOCK','FEED_ONCE','REFILL_FOR','DRAIN_FOR','REFILL_ON','DRAIN_ON');
 IF NEW.command_type NOT IN ('STOP_ALL','RESUME_CONTROLS') AND NOT normal THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW.command_status NOT IN ('pending','running','processing') THEN RETURN NEW; END IF;
 selected_tank=NEW.tank_id::text::uuid;
 IF TG_OP='INSERT' THEN
  -- Serializes normal enqueues and stop requests across tabs/mobile clients.
  PERFORM pg_advisory_xact_lock(hashtextextended('craythrive-control:'||selected_tank::text,0));
  SELECT user_id INTO actor FROM public.tanks WHERE id=selected_tank;
  IF actor IS NULL OR NEW.user_id IS DISTINCT FROM actor OR (auth.uid() IS NOT NULL AND auth.uid()<>actor)
   OR NOT EXISTS(SELECT 1 FROM public.iot_devices WHERE device_uid=NEW.device_uid AND user_id=actor
    AND device_type='actuator_hub' AND is_claimed=true AND (tank_id::text=selected_tank::text OR
      (tank_id IS NULL AND EXISTS(SELECT 1 FROM public.tanks t WHERE t.id=selected_tank AND NEW.device_uid=
       coalesce(nullif(to_jsonb(t)->>'actuator_device_uid',''),nullif(to_jsonb(t)->>'actuator_uid',''),nullif(to_jsonb(t)->>'actuator_device',''))))))
  THEN RAISE EXCEPTION 'Owned paired actuator required' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT emergency_stop_active INTO latched FROM public.tank_automation_settings WHERE tank_id=selected_tank AND user_id=NEW.user_id;
 IF normal AND NEW.command_status IN ('pending','running','processing') THEN
  IF coalesce(latched,false) THEN RAISE EXCEPTION 'Emergency stop is active. Resume controls explicitly.' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD.command_status NOT IN ('pending','running','processing') THEN
   RAISE EXCEPTION 'A terminal command cannot restart' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.device_commands WHERE tank_id::text=selected_tank::text AND device_uid=NEW.device_uid
   AND command_status IN ('pending','running','processing') AND command_type IN ('RESET_FEED_LOCK','FEED_ONCE','REFILL_FOR','DRAIN_FOR','REFILL_ON','DRAIN_ON'))
  THEN RAISE EXCEPTION 'Another actuator action is active' USING ERRCODE='55000'; END IF;
 END IF;
 IF TG_OP='INSERT' AND NEW.command_type='STOP_ALL' THEN
  -- A stop-created first row must not silently opt a previously unconfigured
  -- tank into the default daily feeder schedule. Existing rows stay untouched.
  INSERT INTO public.tank_automation_settings(user_id,tank_id,device_uid,auto_feeding_enabled) VALUES(NEW.user_id,selected_tank,NEW.device_uid,false)
   ON CONFLICT(tank_id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.tank_automation_settings WHERE tank_id=selected_tank AND user_id=NEW.user_id)
   THEN RAISE EXCEPTION 'Settings ownership mismatch' USING ERRCODE='42501'; END IF;
  -- Rejected is the existing, supported terminal cancellation equivalent.
  -- Lock queued command rows before settings, matching acknowledgement order.
  UPDATE public.device_commands SET command_status='rejected',status='rejected',
   result_message='Cancelled because Emergency Stop was activated.'
   WHERE tank_id::text=selected_tank::text AND device_uid=NEW.device_uid AND user_id=NEW.user_id
    AND ((command_status='pending' AND command_type IN ('RESET_FEED_LOCK','FEED_ONCE','REFILL_FOR','DRAIN_FOR','REFILL_ON','DRAIN_ON'))
      OR (command_status IN ('pending','running','processing') AND command_type IN ('RESUME_CONTROLS','STOP_ALL')));
  UPDATE public.tank_automation_settings SET emergency_stop_active=true,emergency_stop_command_id=NEW.id,
   emergency_resume_command_id=NULL,emergency_stop_applied_at=NULL,emergency_stop_generation=emergency_stop_generation+1
   WHERE tank_id=selected_tank AND user_id=NEW.user_id;
 END IF;
 IF TG_OP='INSERT' AND NEW.command_type='RESUME_CONTROLS' AND NOT EXISTS(SELECT 1 FROM public.tank_automation_settings
  WHERE tank_id=selected_tank AND user_id=NEW.user_id AND emergency_stop_active AND emergency_stop_applied_at IS NOT NULL
   AND emergency_resume_command_id=NEW.id) THEN
  RAISE EXCEPTION 'Use the explicit resume control flow' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND OLD.command_type IN ('STOP_ALL','RESUME_CONTROLS') AND OLD.command_status NOT IN ('pending','running','processing')
  AND NEW.command_status IS DISTINCT FROM OLD.command_status THEN
  RAISE EXCEPTION 'Emergency control result is already terminal' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER craythrive_guard_actuator_queue BEFORE INSERT OR UPDATE OF command_status,id,user_id,tank_id,device_uid,command_type ON public.device_commands
 FOR EACH ROW EXECUTE FUNCTION public.craythrive_guard_actuator_queue();

CREATE FUNCTION public.craythrive_apply_emergency_ack() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state public.tank_automation_settings;
BEGIN
 IF NEW.command_type NOT IN ('STOP_ALL','RESUME_CONTROLS') OR NEW.command_status<>'done' OR OLD.command_status='done' THEN RETURN NEW; END IF;
 SELECT * INTO state FROM public.tank_automation_settings WHERE tank_id::text=NEW.tank_id::text AND user_id=NEW.user_id FOR UPDATE;
 IF NEW.command_type='STOP_ALL' THEN
  IF NEW.id IS DISTINCT FROM state.emergency_stop_command_id OR NEW.result_message<>'Emergency stop applied. Pumps and feeder are stopped.' THEN
   RAISE EXCEPTION 'Expected current emergency hardware acknowledgement' USING ERRCODE='55000'; END IF;
  UPDATE public.tank_automation_settings SET emergency_stop_applied_at=clock_timestamp() WHERE tank_id=state.tank_id;
 ELSE
  IF NOT state.emergency_stop_active OR NEW.id IS DISTINCT FROM state.emergency_resume_command_id OR state.emergency_stop_applied_at IS NULL
   OR NEW.result_message<>'Controls resumed. Outputs remain off until a new safe action.'
   OR EXISTS(SELECT 1 FROM public.device_commands WHERE tank_id::text=NEW.tank_id::text AND device_uid=NEW.device_uid
    AND command_type IN ('RESET_FEED_LOCK','FEED_ONCE','REFILL_FOR','DRAIN_FOR','REFILL_ON','DRAIN_ON') AND command_status IN ('pending','running','processing'))
  THEN RAISE EXCEPTION 'Emergency stop is not ready for resume' USING ERRCODE='55000'; END IF;
  UPDATE public.tank_automation_settings SET emergency_stop_active=false WHERE tank_id=state.tank_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER craythrive_apply_emergency_ack AFTER UPDATE OF command_status ON public.device_commands
 FOR EACH ROW EXECUTE FUNCTION public.craythrive_apply_emergency_ack();

CREATE FUNCTION public.get_tank_actuator_control_state(p_tank_id uuid,p_device_uid text,p_command_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; state public.tank_automation_settings; tracked jsonb; active jsonb; stopped jsonb; resumed jsonb; terminal jsonb;
BEGIN
 actor=public.craythrive_emergency_owner(p_tank_id,p_device_uid);
 SELECT * INTO state FROM public.tank_automation_settings WHERE tank_id=p_tank_id AND user_id=actor;
 -- A timeout records lack of acknowledgement, never successful execution.
 UPDATE public.device_commands SET command_status='failed',status='failed',result_message=
  CASE command_type WHEN 'STOP_ALL' THEN 'Emergency stop command timed out because the actuator did not acknowledge it.'
   WHEN 'RESUME_CONTROLS' THEN 'Resume controls timed out because the actuator did not acknowledge it.'
   ELSE 'Feed test lock reset could not be confirmed because the actuator did not acknowledge it.' END
  WHERE user_id=actor AND tank_id::text=p_tank_id::text AND device_uid=p_device_uid
   AND (id IN (state.emergency_stop_command_id,state.emergency_resume_command_id) OR command_type='RESET_FEED_LOCK')
   AND command_status IN ('pending','running','processing') AND created_at<clock_timestamp()-interval '120 seconds';
 SELECT to_jsonb(c) INTO tracked FROM public.device_commands c WHERE c.user_id=actor AND c.tank_id::text=p_tank_id::text AND c.device_uid=p_device_uid
  AND (p_command_id IS NULL OR c.id=p_command_id) ORDER BY c.created_at DESC,c.id DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) INTO active FROM
  (SELECT * FROM public.device_commands WHERE user_id=actor AND tank_id::text=p_tank_id::text AND device_uid=p_device_uid
    AND command_status IN ('pending','running','processing') ORDER BY created_at DESC,id DESC LIMIT 30) c;
 SELECT to_jsonb(c) INTO stopped FROM public.device_commands c WHERE c.id=state.emergency_stop_command_id AND c.user_id=actor AND c.device_uid=p_device_uid;
 SELECT to_jsonb(c) INTO resumed FROM public.device_commands c WHERE c.id=state.emergency_resume_command_id AND c.user_id=actor AND c.device_uid=p_device_uid;
 SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) INTO terminal FROM
  (SELECT * FROM public.device_commands WHERE user_id=actor AND tank_id::text=p_tank_id::text AND device_uid=p_device_uid
    AND command_status NOT IN ('pending','running','processing') ORDER BY created_at DESC,id DESC LIMIT 30) c;
 RETURN jsonb_build_object('tank_id',p_tank_id,'device_uid',p_device_uid,'emergency_stop_active',coalesce(state.emergency_stop_active,false),
  'applied_at',state.emergency_stop_applied_at,'stop_command',stopped,'resume_command',resumed,'command',tracked,'active_commands',active,'terminal_commands',terminal);
END $$;

CREATE FUNCTION public.request_tank_emergency_control(p_tank_id uuid,p_device_uid text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; state public.tank_automation_settings; existing public.device_commands; command_id uuid;
BEGIN
 actor=public.craythrive_emergency_owner(p_tank_id,p_device_uid);
 IF p_action NOT IN ('STOP_ALL','RESUME_CONTROLS') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid emergency action' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('craythrive-control:'||p_tank_id::text,0));
 PERFORM public.get_tank_actuator_control_state(p_tank_id,p_device_uid,NULL);
 -- Enqueues are serialized above; do not lock settings before command rows.
 SELECT * INTO state FROM public.tank_automation_settings WHERE tank_id=p_tank_id AND user_id=actor;
 SELECT * INTO existing FROM public.device_commands WHERE id=CASE WHEN p_action='STOP_ALL' THEN state.emergency_stop_command_id ELSE state.emergency_resume_command_id END;
 IF existing.command_status IN ('pending','running','processing') OR
  (p_action='STOP_ALL' AND state.emergency_stop_active AND state.emergency_resume_command_id IS NULL AND existing.command_status='done') THEN
  RETURN public.get_tank_actuator_control_state(p_tank_id,p_device_uid,existing.id); END IF;
 IF p_action='RESUME_CONTROLS' AND (NOT coalesce(state.emergency_stop_active,false) OR state.emergency_stop_applied_at IS NULL
  OR EXISTS(SELECT 1 FROM public.device_commands WHERE tank_id::text=p_tank_id::text AND device_uid=p_device_uid
    AND command_type IN ('RESET_FEED_LOCK','FEED_ONCE','REFILL_FOR','DRAIN_FOR','REFILL_ON','DRAIN_ON') AND command_status IN ('pending','running','processing'))) THEN
  RAISE EXCEPTION 'Wait for confirmed stop and interrupted commands before resume' USING ERRCODE='55000'; END IF;
 command_id=gen_random_uuid();
 IF p_action='RESUME_CONTROLS' THEN UPDATE public.tank_automation_settings SET emergency_resume_command_id=command_id WHERE tank_id=p_tank_id AND user_id=actor; END IF;
 INSERT INTO public.device_commands(id,user_id,tank_id,device_uid,command_type,command_value,duration_ms,command_status,status,result_message)
  VALUES(command_id,actor,p_tank_id::text,p_device_uid,p_action,CASE WHEN p_action='STOP_ALL' THEN 'stop' ELSE 'resume' END,0,'pending','pending',
   CASE WHEN p_action='STOP_ALL' THEN 'Emergency stop requested. Waiting for actuator...' ELSE 'Resume requested. Waiting for actuator...' END)
  RETURNING id INTO command_id;
 RETURN public.get_tank_actuator_control_state(p_tank_id,p_device_uid,command_id);
END $$;
REVOKE ALL ON FUNCTION public.craythrive_emergency_owner(uuid,text),public.craythrive_guard_actuator_queue(),public.craythrive_apply_emergency_ack(),public.craythrive_protect_emergency_settings() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_tank_actuator_control_state(uuid,text,uuid),public.request_tank_emergency_control(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_tank_actuator_control_state(uuid,text,uuid),public.request_tank_emergency_control(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
