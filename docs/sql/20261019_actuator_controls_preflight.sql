-- Read-only inspection. Run in the intended CrayThrive Supabase SQL Editor.
BEGIN READ ONLY;
SELECT table_name,column_name,data_type,is_nullable,column_default
 FROM information_schema.columns WHERE table_schema='public'
 AND table_name IN ('device_commands','tank_automation_settings','alerts')
 ORDER BY table_name,ordinal_position;
SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE conrelid='public.device_commands'::regclass AND contype='c';
SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger
 WHERE tgrelid IN ('public.device_commands'::regclass,'public.alerts'::regclass) AND NOT tgisinternal;
SELECT md5(pg_get_functiondef(to_regprocedure('public.create_actuator_alert_from_command()'))) AS command_alert_revision;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('device_commands','tank_automation_settings','alerts');
ROLLBACK;
