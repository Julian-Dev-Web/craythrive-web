-- Extend the EXISTING command-alert pipeline. No scheduler or servo changes.
-- No historical executions, notifications, or ambiguous origins are rewritten.
BEGIN;
DO $preflight$ BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.create_actuator_alert_from_command()'))) IS DISTINCT FROM '41b0c2a1915b0972c55bbdc87b8b1c40' THEN
  RAISE EXCEPTION 'Existing command alert function changed; review before deployment rather than overwriting it'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_commands'
   AND column_name IN ('source','origin','trigger_source','execution_source','metadata')) THEN
  RAISE EXCEPTION 'A command origin/metadata column already exists; review and reuse it before adding command_source';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_commands' AND column_name='command_type' AND data_type='text') THEN
  RAISE EXCEPTION 'Review device_commands command_type schema before deployment'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.device_commands'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) ~ 'command_type') THEN
  RAISE EXCEPTION 'Review command_type CHECK constraints for RESET_FEED_LOCK and RESUME_CONTROLS; no constraint is weakened automatically'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.device_commands'::regclass
   AND tgname='trg_create_actuator_alert_from_command' AND tgfoid='public.create_actuator_alert_from_command()'::regprocedure) THEN
  RAISE EXCEPTION 'Existing actuator alert trigger changed; review before deployment'; END IF;
END $preflight$;
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS command_source text;
ALTER TABLE public.device_commands ADD CONSTRAINT craythrive_command_source_check
 CHECK(command_source IS NULL OR command_source IN ('manual','schedule','automation','system'));
CREATE UNIQUE INDEX craythrive_scheduled_feed_alert_once ON public.alerts(command_id)
 WHERE command_id IS NOT NULL AND source='device_commands' AND metadata->>'command_source'='schedule';
CREATE OR REPLACE FUNCTION public.create_actuator_alert_from_command()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  alert_title text;
  alert_message text;
  alert_severity text;
  command_label text;
  safe_user_id uuid;
  safe_tank_id uuid;
  pump_wording jsonb;
begin
  -- Direct completed INSERTs and status transitions share the existing pipeline.
  if new.command_type='FEED_ONCE' and new.command_source='schedule' and coalesce(new.command_status,new.status) in ('done','completed') then
    perform pg_advisory_xact_lock(hashtextextended('craythrive-command-alert:'||new.id::text,0));
    if exists(select 1 from public.alerts where command_id=new.id) then return new; end if;
    if new.user_id is null or new.tank_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return new; end if;
    select coalesce(to_jsonb(t)->>'tank_name',to_jsonb(t)->>'name','Tank') into command_label
      from public.tanks t where t.id=new.tank_id::uuid and t.user_id=new.user_id;
    if not found then return new; end if;
    alert_message := command_label || ' ran its automatic feeder' || case when new.command_value ~ '^[123]$'
      then ' with '||new.command_value||' dispense '||case when new.command_value='1' then 'cycle' else 'cycles' end
      else ' (dispense cycles not recorded)' end || '. Servo sequence completed; physical feed delivery is not sensor-verified. Executed: ' ||
      to_char(coalesce(new.executed_at,new.created_at,now()) at time zone 'Asia/Manila','Mon DD, YYYY HH12:MI AM') || ' (Asia/Manila).';
    insert into public.alerts(user_id,tank_id,device_uid,type,title,message,severity,source,command_id,metadata,created_at)
    values(new.user_id,new.tank_id::uuid,new.device_uid::text,'actuator_command','Automatic Feeding Completed',alert_message,
      'normal','device_commands',new.id,jsonb_build_object('command_type',new.command_type,'command_status',coalesce(new.command_status,new.status),
      'command_source',new.command_source,'dispense_cycles',case when new.command_value ~ '^[123]$' then new.command_value::integer else null end,
      'executed_at',coalesce(new.executed_at,new.created_at)),coalesce(new.executed_at,new.created_at,now())) on conflict do nothing;
    return new;
  end if;

  -- Only final statuses should create user alerts.
  if new.command_status not in ('done', 'rejected', 'failed') then
    return new;
  end if;

  -- Avoid duplicate when same status is updated again.
  if TG_OP='UPDATE' and old.command_status = new.command_status then
    return new;
  end if;

  -- Safely cast user_id/tank_id to UUID only if valid UUID text.
  if new.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    safe_user_id := new.user_id::uuid;
  else
    safe_user_id := null;
  end if;

  if new.tank_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    safe_tank_id := new.tank_id::uuid;
  else
    safe_tank_id := null;
  end if;

  -- Avoid duplicate alert for the same command.
  if exists (
    select 1
    from public.alerts
    where command_id = new.id
  ) then
    return new;
  end if;

  command_label :=
    case new.command_type
      when 'FEED_ONCE' then 'Feed'
      when 'DRAIN_FOR' then 'Drain'
      when 'REFILL_FOR' then 'Refill'
      when 'STOP_ALL' then 'Stop All'
      when 'RESET_FEED_LOCK' then 'Feed test lock reset'
      when 'RESUME_CONTROLS' then 'Resume controls'
      else coalesce(new.command_type, 'Command')
    end;


  if new.command_status = 'done' then
    alert_severity := 'normal';

    alert_title :=
      case new.command_type
        when 'FEED_ONCE' then 'Feeding completed'
        when 'DRAIN_FOR' then 'Drain completed'
        when 'REFILL_FOR' then 'Add Water completed'
        when 'STOP_ALL' then 'Actuators stopped'
        when 'RESET_FEED_LOCK' then 'Feed test lock reset'
        when 'RESUME_CONTROLS' then 'Controls resumed'
        else command_label || ' completed'
      end;

    alert_message :=
      case new.command_type
        when 'FEED_ONCE' then 'Feeder servo command sequence completed' || case when new.command_value ~ '^[123]$'
          then ' with '||new.command_value||' dispense '||case when new.command_value='1' then 'cycle' else 'cycles' end
          else ' (dispense cycles not recorded)' end || '. Physical feed delivery is not sensor-verified.'
        when 'DRAIN_FOR' then 'The drain pump was activated.'
        when 'REFILL_FOR' then 'The refill pump was activated.'
        when 'STOP_ALL' then 'All pump and feeder actuators were stopped.'
        when 'RESET_FEED_LOCK' then 'The actuator cleared its daily feed lock. No feed was dispensed by this maintenance command. Normal safety checks still apply.'
        when 'RESUME_CONTROLS' then 'Controls resumed explicitly. Outputs remain off until a new safe action.'
        else 'The actuator command was completed.'
      end;

  elsif new.command_status = 'rejected' then
    alert_severity := 'warning';
    alert_title := command_label || ' blocked by safety check';
    alert_message := 'The command was blocked by CrayThrive safety rules. View logs for details.';

  else
    alert_severity := 'critical';
    alert_title := command_label || ' command failed';
    alert_message := 'The actuator command failed. Check ESP32 power, WiFi, or wiring.';
  end if;

  pump_wording := public.craythrive_pump_action_wording(to_jsonb(new));
  if pump_wording is not null then
    alert_title := pump_wording->>'title';
    alert_message := pump_wording->>'message';
  end if;

  insert into public.alerts (
    user_id,
    tank_id,
    device_uid,
    type,
    title,
    message,
    severity,
    source,
    command_id,
    metadata,
    created_at
  )
  values (
    safe_user_id,
    safe_tank_id,
    new.device_uid::text,
    'actuator_command',
    alert_title,
    alert_message,
    alert_severity,
    'device_commands',
    new.id,
    jsonb_build_object('command_type', new.command_type, 'command_status', new.command_status, 'duration_ms', new.duration_ms,
      'command_source',new.command_source,'command_value',new.command_value) || case when pump_wording ? 'actual_duration_ms' then
      jsonb_build_object('actual_duration_ms',pump_wording->'actual_duration_ms') else '{}'::jsonb end,
    now()
  );

  return new;
end;
$function$;

DROP TRIGGER trg_create_actuator_alert_from_command ON public.device_commands;
CREATE TRIGGER trg_create_actuator_alert_from_command AFTER INSERT OR UPDATE OF command_status,status,command_source ON public.device_commands
 FOR EACH ROW EXECUTE FUNCTION public.create_actuator_alert_from_command();
NOTIFY pgrst,'reload schema';
COMMIT;
