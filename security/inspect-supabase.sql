-- READ ONLY. Run in the Supabase SQL Editor and export the result sets.
-- Policy definitions/function bodies may contain sensitive literals: redact before sharing.
begin transaction read only;

-- Missing tables, disabled RLS, and views requiring separate scrutiny.
with expected(name) as (values
  ('profiles'), ('tanks'), ('iot_devices'), ('devices'), ('sensor_readings'),
  ('ammonia_readings'), ('alerts'), ('threshold_settings'), ('control_logs'),
  ('device_commands'), ('marketplace_listings'), ('marketplace_orders'),
  ('seller_profiles'), ('marketplace_chat_threads'), ('marketplace_chat_messages'),
  ('notification_preferences'), ('push_tokens')
)
select e.name, c.relkind, c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls, c.reloptions,
  case when c.oid is null then 'MISSING / VERIFY NAME'
       when c.relkind in ('v', 'm') then 'VIEW: REVIEW OWNER / SECURITY INVOKER'
       when not c.relrowsecurity then 'RLS DISABLED'
       else 'INSPECT POLICIES AND GRANTS' end as review
from expected e left join pg_class c on c.oid = to_regclass('public.' || e.name)
order by e.name;

-- Every public relation, including tables not anticipated by the frontend.
select n.nspname as schema, c.relname, c.relkind, c.relrowsecurity, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns where table_schema in ('public', 'storage')
order by table_schema, table_name, ordinal_position;

select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema in ('public', 'storage') and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_schema, table_name, grantee, privilege_type;

select table_schema, table_name, column_name, grantee, privilege_type
from information_schema.role_column_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, column_name;

-- Exposed functions and definer functions need a separate authorization audit.
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer, p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.proname;

select event_object_schema, event_object_table, trigger_name, action_statement
from information_schema.triggers where event_object_schema = 'public'
order by event_object_table, trigger_name;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets order by name;

-- Only counts: do not export object names or private file contents.
select bucket_id, count(*) as total,
  count(*) filter (where (storage.foldername(name))[1] is null) as missing_owner_folder
from storage.objects group by bucket_id order by bucket_id;

rollback;
