CREATE OR REPLACE FUNCTION public.mirror_tank_automation_log_to_device_commands()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  safe_user_id uuid;
  mapped_command_type text;
  mapped_status text;
  mapped_duration_ms integer;
  log_message text;
begin
  safe_user_id := new.user_id;

  if safe_user_id is null then
    select t.user_id
    into safe_user_id
    from public.tanks t
    where t.id = new.tank_id
    limit 1;
  end if;

  mapped_command_type :=
    case new.action_type
      when 'AUTO_REFILL' then 'REFILL_FOR'
      when 'AUTO_DRAIN' then 'DRAIN_FOR'
      when 'AUTO_FEED' then 'FEED_ONCE'
      when 'AUTO_STOP' then 'STOP_ALL'
      else new.action_type
    end;

  mapped_status :=
    case new.action_status
      when 'done' then 'done'
      when 'failed' then 'failed'
      when 'blocked' then 'rejected'
      when 'skipped' then 'rejected'
      else 'done'
    end;

  mapped_duration_ms := coalesce(new.duration_seconds, 0) * 1000;

  log_message :=
    'Automatic water assist: ' ||
    coalesce(new.reason, new.action_type, 'Auto action completed') ||
    ' | Water: ' || coalesce(new.water_status, 'N/A') ||
    ' | Stable readings: ' || coalesce(new.stable_reading_count::text, 'N/A') ||
    ' | Auto log id: ' || new.id::text;

  insert into public.device_commands (
    user_id,
    tank_id,
    device_uid,
    command_type,
    command_value,
    duration_ms,
    command_status,
    result_message,
    created_at,
    executed_at
  )
  values (
    safe_user_id,
    new.tank_id,
    new.device_uid,
    mapped_command_type,
    'auto',
    mapped_duration_ms,
    mapped_status,
    log_message,
    new.created_at,
    new.created_at
  );

  return new;
end;
$function$;
