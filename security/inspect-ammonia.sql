-- READ-ONLY inspection, not a migration. No scan rows or credentials are exported.
-- Run against the current database before deciding whether any SQL is necessary.
begin transaction read only;

select to_regclass('public.ammonia_readings') as ammonia_table,
       to_regclass('public.sensor_readings') as sensor_table;

select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'ammonia_readings'
order by ordinal_position;

-- Actual primary key, tank/user ownership foreign keys, and check constraints.
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = to_regclass('public.ammonia_readings')
order by contype, conname;

select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c where c.oid = to_regclass('public.ammonia_readings');

select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'ammonia_readings'
order by policyname;

select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ammonia_readings'
order by grantee, privilege_type;

-- Review full index definitions: an existing ascending B-tree may also serve
-- descending scans. Check leading ownership keys and partial predicates too.
select i.indexrelid::regclass as index_name, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid) as index_definition,
       pg_get_expr(i.indpred, i.indrelid) as predicate
from pg_index i where i.indrelid = to_regclass('public.ammonia_readings');

-- Detect any ingestion/backfill trigger that might copy a scan into sensor rows.
select event_object_table, trigger_name, action_statement
from information_schema.triggers where event_object_schema = 'public'
  and event_object_table in ('ammonia_readings', 'sensor_readings')
order by event_object_table, trigger_name;

-- Inspect associated trigger bodies as well as their names for hidden backfill.
select t.tgname, p.oid::regprocedure as trigger_function,
       pg_get_functiondef(p.oid) as function_definition
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and t.tgrelid in (
  to_regclass('public.ammonia_readings'), to_regclass('public.sensor_readings'));

-- Inspect sensor columns without adding/removing any of them.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'sensor_readings'
order by ordinal_position;

rollback;
