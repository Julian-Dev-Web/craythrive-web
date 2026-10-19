-- Read-only inspection of the intended Supabase project before the activity/
-- notification migration. Does not enqueue actions or change hardware settings.
BEGIN READ ONLY;
SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN ('tank_automation_logs','alerts','notification_preferences')
 ORDER BY table_name,ordinal_position;
SELECT p.oid::regprocedure AS signature,p.prosecdef,p.proconfig
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('get_tank_automation_history','create_alert_if_enabled');
SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE t.tgrelid IN ('public.tank_automation_logs'::regclass,'public.alerts'::regclass,'public.device_commands'::regclass,'public.control_logs'::regclass)
 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
SELECT a.id,a.tank_id,a.action_type,a.action_status,a.reason,a.duration_seconds,a.created_at,
 a.created_at AT TIME ZONE 'Asia/Manila' AS philippine_display_time
 FROM public.tank_automation_logs a WHERE a.action_type IN ('AUTO_REFILL','AUTO_DRAIN')
 ORDER BY a.created_at DESC,a.id DESC LIMIT 25;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('tank_automation_logs','alerts');
ROLLBACK;
