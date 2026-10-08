-- Read-only metadata, no application row contents or function bodies.
begin transaction read only;
select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind,
    'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid,a.atttypmod),
      'generated', a.attgenerated, 'identity', a.attidentity) order by a.attnum)
      from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'primaryKey', (select jsonb_agg(a.attname order by k.ord) from pg_index i
      cross join lateral unnest(i.indkey) with ordinality k(num,ord)
      join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num where i.indrelid=c.oid and i.indisprimary)
    ) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')),
  'foreignKeys', (select jsonb_agg(jsonb_build_object('table', c.conrelid::regclass::text,
    'parent', c.confrelid::regclass::text, 'deferrable', c.condeferrable))
    from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f'),
  'triggers', (select jsonb_agg(jsonb_build_object('table', c.relname, 'name', t.tgname, 'function', p.proname))
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid where n.nspname='public' and not t.tgisinternal)
) as metadata;
rollback;
