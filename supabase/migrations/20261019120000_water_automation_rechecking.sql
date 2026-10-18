-- Status/presentation compatibility only. No history rewrite, actuator commands,
-- timing, safety interlocks, RLS or table grants are changed.
BEGIN;
DO $schema$
DECLARE
  status_column smallint;
  status_type oid;
  item record;
BEGIN
  SELECT attnum, atttypid INTO status_column, status_type FROM pg_attribute
    WHERE attrelid = 'public.tank_automation_logs'::regclass
      AND attname = 'action_status' AND NOT attisdropped;
  IF status_column IS NULL THEN RAISE EXCEPTION 'Missing automation action_status column'; END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE oid = status_type AND typtype = 'e') THEN
    EXECUTE format('ALTER TYPE %s ADD VALUE IF NOT EXISTS %L', status_type::regtype, 'rechecking');
  END IF;
  FOR item IN SELECT conname, conkey, convalidated, pg_get_expr(conbin, conrelid) AS expression
    FROM pg_constraint WHERE conrelid = 'public.tank_automation_logs'::regclass
      AND contype = 'c' AND status_column = ANY(conkey)
  LOOP
    -- Do not broaden a composite safety constraint. Require manual review.
    IF item.conkey <> ARRAY[status_column]::smallint[] THEN
      RAISE EXCEPTION 'Review composite automation constraint % before adding rechecking', item.conname;
    END IF;
    IF position('rechecking' IN item.expression) = 0 THEN
      EXECUTE format('ALTER TABLE public.tank_automation_logs DROP CONSTRAINT %I', item.conname);
      EXECUTE format('ALTER TABLE public.tank_automation_logs ADD CONSTRAINT %I CHECK ((%s) OR action_status::text = %L) NOT VALID',
        item.conname, item.expression, 'rechecking');
      IF item.convalidated THEN
        EXECUTE format('ALTER TABLE public.tank_automation_logs VALIDATE CONSTRAINT %I', item.conname);
      END IF;
    END IF;
  END LOOP;
  -- An unconstrained text column remains unconstrained; preserve all old values.
END $schema$;

DO $presentation$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.craythrive_pump_action_wording(jsonb)')) INTO definition;
  IF definition IS NULL THEN RAISE EXCEPTION 'Existing pump wording function is required'; END IF;
  IF position('-- water-rechecking-v1' IN definition) = 0 THEN
    IF position('if execution_status in (''rejected'',''blocked'') then' IN definition) = 0
      OR position('''pending'',''queued'',''running'',''executing''' IN definition) = 0 THEN
      RAISE EXCEPTION 'Pump wording function changed; review migration before applying';
    END IF;
    definition := replace(definition, '''pending'',''queued'',''running'',''executing''',
      '''pending'',''queued'',''running'',''executing'',''rechecking'',''skipped''');
    definition := replace(definition, 'if execution_status in (''rejected'',''blocked'') then', $replacement$
  -- water-rechecking-v1
  if lower(coalesce(record->>'action_status',metadata->>'action_status','')) = 'rechecking'
    or coalesce(record->>'result_message','') ~* 'Auto action status: rechecking' then
    execution_status := 'rechecking';
  end if;
  if execution_status = 'rechecking' then
    return jsonb_build_object('title',label || ' – Executed – Rechecking',
      'message','The ' || action_label || ' pump was activated successfully. Fresh sensor readings are being evaluated to confirm the expected water-level change before another automatic water action.');
  elsif execution_status = 'skipped' then
    return jsonb_build_object('title',label || ' – Skipped','message','The action was intentionally skipped.');
  elsif execution_status = 'failed'
    and (action in ('auto_refill','auto_drain') or record->>'command_value' = 'auto')
    and coalesce(record->>'reason',record->>'notes',record->>'result_message',metadata->>'notes',record->>'message','')
      !~* '(actuator|pump|relay|execution|action).{0,25}interrupt|interrupt.{0,25}(actuator|pump|relay|execution|action)|stop[_ ]?all|stop command|emergency stop|safety.{0,25}abort|abort.{0,25}(execution|pump|action)|(actuator|pump|relay|control|execution|action).{0,35}(could not|cannot|unable|failed to).{0,25}(execute|complete|start|activate)|execution (error|failed)|hardware (error|fault)' then
    return jsonb_build_object('title',label || ' – Pending Verification',
      'message','The saved reason does not confirm an actuator execution failure. Check the recorded sensor verification details.');
  elsif execution_status in ('rejected','blocked') then$replacement$);
    EXECUTE definition;
  END IF;

  -- Keep the existing terminal command status: pending is an executable queue
  -- state and could accidentally request a second pump action. Preserve the
  -- original outcome in the diagnostic text for history presentation only.
  SELECT pg_get_functiondef(to_regprocedure('public.mirror_tank_automation_log_to_device_commands()')) INTO definition;
  IF definition IS NULL THEN RAISE EXCEPTION 'Existing automation mirror function is required'; END IF;
  IF position('Auto action status:' IN definition) = 0 THEN
    IF position(''' | Auto log id: ''' IN definition) = 0 THEN
      RAISE EXCEPTION 'Automation mirror function changed; review migration before applying';
    END IF;
    definition := replace(definition, ''' | Auto log id: ''',
      ''' | Auto action status: '' || coalesce(new.action_status::text, ''unknown'') || '' | Auto log id: ''');
    EXECUTE definition;
  END IF;
END $presentation$;
COMMIT;
