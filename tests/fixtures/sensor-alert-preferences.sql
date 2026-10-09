-- Offline test support: existing production notification-preference helper.
CREATE OR REPLACE FUNCTION public.create_alert_if_enabled(p_user_id uuid, p_tank_id uuid, p_category text, p_type text, p_title text, p_message text, p_severity text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  allowed boolean;
begin
  allowed := true;

  if p_user_id is null then
    return;
  end if;

  if p_category = 'tank_alerts' then
    select coalesce(tank_alerts, true)
    into allowed
    from public.notification_preferences
    where user_id = p_user_id;

  elsif p_category = 'marketplace_alerts' then
    select coalesce(marketplace_alerts, true)
    into allowed
    from public.notification_preferences
    where user_id = p_user_id;

  elsif p_category = 'feeding_alerts' then
    select coalesce(feeding_alerts, true)
    into allowed
    from public.notification_preferences
    where user_id = p_user_id;

  elsif p_category = 'pump_alerts' then
    select coalesce(pump_alerts, true)
    into allowed
    from public.notification_preferences
    where user_id = p_user_id;
  end if;

  if allowed is null then
    allowed := true;
  end if;

  if allowed = true then
    insert into public.alerts (
      user_id,
      tank_id,
      type,
      title,
      message,
      severity,
      is_read,
      metadata
    )
    values (
      p_user_id,
      p_tank_id,
      p_type,
      p_title,
      p_message,
      coalesce(p_severity, 'info'),
      false,
      coalesce(p_metadata, '{}'::jsonb)
    );
  end if;
end;
$function$
;
