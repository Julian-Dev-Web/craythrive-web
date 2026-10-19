-- Read-only diagnostic for the scheduled-feeding migration fingerprint error.
-- Clear the transaction left by the failed migration, if any.
ROLLBACK;
BEGIN READ ONLY;

-- One result cell: copy this JSON so the current function can be reviewed.
-- No sensor rows, command history, or user records are queried.
SELECT jsonb_build_object(
 'command_alert_function', to_regprocedure('public.create_actuator_alert_from_command()')::text,
 'command_alert_revision', md5(pg_get_functiondef(to_regprocedure('public.create_actuator_alert_from_command()'))),
 'command_alert_revision_lf', md5(replace(pg_get_functiondef(to_regprocedure('public.create_actuator_alert_from_command()')), E'\r\n', E'\n')),
 'command_alert_definition', pg_get_functiondef(to_regprocedure('public.create_actuator_alert_from_command()')),
 'command_columns', (
   SELECT coalesce(jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable) ORDER BY ordinal_position),'[]'::jsonb)
   FROM information_schema.columns
   WHERE table_schema='public' AND table_name='device_commands'
 ),
 'command_constraints', (
   SELECT coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname),'[]'::jsonb)
   FROM pg_constraint WHERE conrelid=to_regclass('public.device_commands') AND contype='c'
 ),
 'command_triggers', (
   SELECT coalesce(jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname),'[]'::jsonb)
   FROM pg_trigger WHERE tgrelid=to_regclass('public.device_commands') AND NOT tgisinternal
 ),
 'scheduled_feed_index', to_regclass('public.craythrive_scheduled_feed_alert_once')::text,
 'control_state_rpc', to_regprocedure('public.get_tank_actuator_control_state(uuid,text,uuid)')::text,
 'emergency_request_rpc', to_regprocedure('public.request_tank_emergency_control(uuid,text,text)')::text,
 'pump_wording_helper', to_regprocedure('public.craythrive_pump_action_wording(jsonb)')::text
) AS actuator_alert_review;

ROLLBACK;
