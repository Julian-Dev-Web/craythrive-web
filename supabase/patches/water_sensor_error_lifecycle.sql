-- REVIEW / MANUAL APPLY ONLY. Never automatically deployed by this task.
-- Changes the existing sensor-alert FUNCTION LOGIC only. No tables, columns,
-- indexes, thresholds, or triggers are added/altered. Other parameter alert
-- branches are retained from the inspected production function.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_alert_from_sensor_reading()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  prev_temperature_status text;
  prev_ph_status text;
  prev_turbidity_status text;
  prev_water_status text;

  temp_status text;
  ph_status_clean text;
  turb_status text;
  water_status_clean text;

begin

  -- =======================================================
  -- NORMALIZE CURRENT STATUS NAMES
  -- =======================================================

  temp_status :=
    upper(
      replace(
        replace(
          trim(
            coalesce(
              new.temperature_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    );

  ph_status_clean :=
    upper(
      replace(
        replace(
          trim(
            coalesce(
              new.ph_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    );

  turb_status :=
    upper(
      replace(
        replace(
          trim(
            coalesce(
              new.turbidity_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    );

  water_status_clean :=
    upper(
      replace(
        replace(
          trim(
            coalesce(
              new.water_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    );


  -- =======================================================
  -- GET PREVIOUS READING FOR THE SAME TANK
  --
  -- Prevents duplicate alert every time ESP32 uploads.
  -- =======================================================

  select

    upper(
      replace(
        replace(
          trim(
            coalesce(
              sr.temperature_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    ),

    upper(
      replace(
        replace(
          trim(
            coalesce(
              sr.ph_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    ),

    upper(
      replace(
        replace(
          trim(
            coalesce(
              sr.turbidity_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    ),

    upper(
      replace(
        replace(
          trim(
            coalesce(
              sr.water_status,
              ''
            )
          ),
          '-',
          '_'
        ),
        ' ',
        '_'
      )
    )

  into

    prev_temperature_status,
    prev_ph_status,
    prev_turbidity_status,
    prev_water_status

  from public.sensor_readings sr

  where sr.tank_id = new.tank_id

    and sr.id <> new.id

  order by sr.created_at desc

  limit 1;


  -- =======================================================
  -- TEMPERATURE
  --
  -- SAFE_IDEAL = NO ALERT
  -- =======================================================

  if temp_status
       is distinct from
       prev_temperature_status
  then

    if temp_status = 'COLD_WARNING' then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Low temperature warning',
        'Water temperature is ' ||
          coalesce(
            round(
              new.temperature_c::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' °C.',
        'warning'
      );


    elsif temp_status = 'HOT_WARNING' then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'High temperature warning',
        'Water temperature is ' ||
          coalesce(
            round(
              new.temperature_c::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' °C.',
        'warning'
      );


    elsif temp_status = 'CRITICAL_COLD' then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Critical low temperature',
        'Water temperature is critically low at ' ||
          coalesce(
            round(
              new.temperature_c::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' °C.',
        'critical'
      );


    elsif temp_status = 'CRITICAL_HOT' then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Critical high temperature',
        'Water temperature is critically high at ' ||
          coalesce(
            round(
              new.temperature_c::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' °C.',
        'critical'
      );


    elsif temp_status = 'SENSOR_ERROR' then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Temperature sensor error',
        'The temperature sensor is not providing a valid reading.',
        'critical'
      );

    end if;

  end if;


  -- =======================================================
  -- pH
  --
  -- IDEAL_PH_LEVEL = NO ALERT
  -- =======================================================

  if ph_status_clean
       is distinct from
       prev_ph_status
  then

    if ph_status_clean = 'LOW_ACIDIC' then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Low pH warning',
        'Current pH is ' ||
          coalesce(
            round(
              new.ph_value::numeric,
              2
            )::text,
            'N/A'
          ) ||
          '.',
        'warning'
      );


    elsif ph_status_clean =
          'HIGH_ALKALINE_WARNING'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'High pH warning',
        'Current pH is ' ||
          coalesce(
            round(
              new.ph_value::numeric,
              2
            )::text,
            'N/A'
          ) ||
          '.',
        'warning'
      );


    elsif ph_status_clean =
          'CRITICAL_ACIDIC'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Critical acidic pH',
        'pH is critically acidic at ' ||
          coalesce(
            round(
              new.ph_value::numeric,
              2
            )::text,
            'N/A'
          ) ||
          '.',
        'critical'
      );


    elsif ph_status_clean =
          'CRITICAL_ALKALINE'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Critical alkaline pH',
        'pH is critically alkaline at ' ||
          coalesce(
            round(
              new.ph_value::numeric,
              2
            )::text,
            'N/A'
          ) ||
          '.',
        'critical'
      );


    elsif ph_status_clean =
          'SENSOR_ERROR'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'pH sensor error',
        'The pH sensor is not providing a valid reading.',
        'critical'
      );

    end if;

  end if;


  -- =======================================================
  -- TURBIDITY
  --
  -- ESP32 rules:
  --
  -- >= 2.37 V      CLEAR
  -- 2.20 - 2.36 V  SLIGHTLY_CLOUDY
  -- 1.50 - 2.19 V  DIRTY
  -- < 1.50 V       CRITICAL_DIRTY
  --
  -- CLEAR = NO ALERT
  -- =======================================================

  if turb_status
       is distinct from
       prev_turbidity_status
  then

    if turb_status =
       'SLIGHTLY_CLOUDY'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Water slightly cloudy',
        'Turbidity voltage is ' ||
          coalesce(
            round(
              new.turbidity_voltage::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' V.',
        'warning'
      );


    elsif turb_status = 'DIRTY' then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Dirty water detected',
        'Turbidity voltage is ' ||
          coalesce(
            round(
              new.turbidity_voltage::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' V.',
        'warning'
      );


    elsif turb_status =
          'CRITICAL_DIRTY'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Critical water clarity',
        'Water is critically dirty. Turbidity voltage is ' ||
          coalesce(
            round(
              new.turbidity_voltage::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' V.',
        'critical'
      );


    elsif turb_status =
          'SENSOR_ERROR'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Turbidity sensor error',
        'The turbidity sensor is not providing a valid reading.',
        'critical'
      );

    end if;

  end if;


  -- =======================================================
  -- WATER LEVEL
  --
  -- IMPORTANT:
  --
  -- USE water_depth_cm
  -- NEVER water_distance_cm
  --
  -- SAFE_IDEAL = NO ALERT
  -- =======================================================

  -- One active water SENSOR_ERROR episode per owner/tank/sensor/error key.
  -- Transaction lock prevents concurrent sensor inserts creating two alerts.
  perform pg_advisory_xact_lock(hashtextextended(
    concat('craythrive:water_level:SENSOR_ERROR:', new.user_id, ':', new.tank_id), 0
  ));

  if water_status_clean = 'SENSOR_ERROR' then
    if not exists (select 1 from public.alerts where user_id = new.user_id
      and tank_id = new.tank_id
      and type = 'sensor_reading'
      and coalesce(status, 'active') = 'active'
      and (
        (metadata->>'sensor_type' = 'water_level' and upper(metadata->>'error_type') = 'SENSOR_ERROR')
        or lower(title) in ('water level sensor error', 'water-level sensor error')
      )) then
      perform public.create_alert_if_enabled(
        new.user_id, new.tank_id, 'tank_alerts', 'sensor_reading',
        'Water level sensor error',
        'The water-level sensor has a confirmed failure. Waiting for a fresh valid measurement.',
        'critical',
        jsonb_build_object(
          'sensor_type', 'water_level', 'error_type', 'SENSOR_ERROR',
          'dedupe_key', concat(new.tank_id, ':water_level:SENSOR_ERROR'),
          'sensor_reading_id', new.id, 'source', 'sensor_health'
        )
      );
    end if;
  elsif water_status_clean in ('SAFE_IDEAL', 'LOW_WARNING', 'HIGH_WARNING', 'CRITICAL_LOW', 'CRITICAL_HIGH')
      and coalesce(new.water_depth_cm, new.water_level) >= 0
      and coalesce(new.raw_payload->>'water_measurement_fresh', 'true') <> 'false'
      and coalesce(new.raw_payload->>'water_value_source', 'fresh') <> 'last_good'
      and coalesce(new.raw_payload #>> '{sensor_health,water_level,health}', 'OK') <> 'ERROR' then
    -- A stale/waiting row never resolves an active failure. Only fresh valid
    -- water recovery closes it, allowing a later genuinely new episode.
    update public.alerts
    set status = 'resolved', resolved_at = now(), is_read = true
    where user_id = new.user_id
      and tank_id = new.tank_id
      and type = 'sensor_reading'
      and coalesce(status, 'active') = 'active'
      and (
        (metadata->>'sensor_type' = 'water_level' and upper(metadata->>'error_type') = 'SENSOR_ERROR')
        or lower(title) in ('water level sensor error', 'water-level sensor error')
      );
  end if;

  if coalesce(new.raw_payload->>'water_measurement_fresh', 'true') <> 'false'
      and coalesce(new.raw_payload->>'water_value_source', 'fresh') <> 'last_good'
      and coalesce(new.raw_payload #>> '{sensor_health,water_level,health}', 'OK') <> 'ERROR'
      and water_status_clean
       is distinct from
       prev_water_status
  then

    if water_status_clean =
       'LOW_WARNING'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Low water level',
        'Water depth is ' ||
          coalesce(
            round(
              new.water_depth_cm::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' cm.',
        'warning'
      );


    elsif water_status_clean =
          'CRITICAL_LOW'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Critical low water level',
        'Water depth is critically low at ' ||
          coalesce(
            round(
              new.water_depth_cm::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' cm.',
        'critical'
      );


    elsif water_status_clean =
          'HIGH_WARNING'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'High water level',
        'Water depth is ' ||
          coalesce(
            round(
              new.water_depth_cm::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' cm.',
        'warning'
      );


    elsif water_status_clean =
          'CRITICAL_HIGH'
    then

      insert into public.alerts (
        user_id,
        tank_id,
        type,
        title,
        message,
        severity
      )
      values (
        new.user_id,
        new.tank_id,
        'sensor_reading',
        'Critical high water level',
        'Water depth is critically high at ' ||
          coalesce(
            round(
              new.water_depth_cm::numeric,
              2
            )::text,
            'N/A'
          ) ||
          ' cm.',
        'critical'
      );



    end if;

  end if;


  return new;

end;

$function$
;
COMMIT;
