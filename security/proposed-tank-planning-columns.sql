-- REVIEW DRAFT ONLY. Do not run before inspecting the actual schema using
-- inspect-tanks.sql and comparing the mobile Add Tank field names/units.
-- No table, ownership, type, RLS, grants, defaults or existing rows are changed.
-- Existing equivalent columns are preserved. All additions are nullable.
-- This cannot fix a required device column or incompatible tank-type check;
-- those need a separate review of the actual constraints and mobile client.
begin;

-- After reviewing, deliberately replace the guard below with:
-- set local craythrive.tank_migration_reviewed = 'true';
set local craythrive.tank_migration_reviewed = 'false';

do $$
declare item record;
begin
  if current_setting('craythrive.tank_migration_reviewed', true) is distinct from 'true' then
    raise exception 'Review inspect-tanks.sql results and mobile field compatibility before applying this draft';
  end if;
  if to_regclass('public.tanks') is null then
    raise exception 'Existing public.tanks table not found; do not create a separate web tank table';
  end if;
  for item in select * from (values
    ('length_cm', 'numeric', array['length_cm', 'tank_length_cm']),
    ('width_cm', 'numeric', array['width_cm', 'tank_width_cm']),
    ('height_cm', 'numeric', array['height_cm', 'tank_height_cm']),
    ('normal_water_depth_cm', 'numeric', array['normal_water_depth_cm', 'working_water_depth_cm', 'target_water_depth_cm']),
    ('crayfish_count', 'bigint', array['crayfish_count', 'population']),
    ('shelter_count', 'bigint', array['shelter_count', 'shelters_count', 'number_of_shelters']),
    ('notes', 'text', array['notes'])
  ) as fields(column_name, column_type, equivalent_columns)
  loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'tanks'
        and c.column_name = any(item.equivalent_columns)
    ) then
      execute format('alter table public.tanks add column %I %s null', item.column_name, item.column_type);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
