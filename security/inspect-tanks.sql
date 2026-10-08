-- Read-only inspection before configuring the shared web/mobile tank writer.
-- Export schema results only; do not share credentials or private row data.
begin transaction read only;

select to_regclass('public.tanks') as tank_table;
select column_name, data_type, udt_name, is_nullable, column_default,
       character_maximum_length, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public' and table_name = 'tanks'
order by ordinal_position;

select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = to_regclass('public.tanks');

select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c where c.oid = to_regclass('public.tanks');
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'tanks';
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'tanks';
select i.indexrelid::regclass as index_name, i.indisvalid,
       pg_get_indexdef(i.indexrelid) as definition
from pg_index i where i.indrelid = to_regclass('public.tanks');

-- Existing enum values, if tank type uses a PostgreSQL enum.
select a.attname as column_name, e.enumlabel
from pg_attribute a join pg_enum e on e.enumtypid = a.atttypid
where a.attrelid = to_regclass('public.tanks') and not a.attisdropped
order by a.attname, e.enumsortorder;

-- Required defaults and triggers may affect device-free creation.
select t.tgname, pg_get_triggerdef(t.oid) as definition,
       t.tgfoid::regprocedure as trigger_function
from pg_trigger t where t.tgrelid = to_regclass('public.tanks') and not t.tgisinternal;

rollback;
