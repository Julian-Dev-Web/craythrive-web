import { BACKUP_TABLES, MAX_TABLE_ROWS, MAX_TOTAL_ROWS, DeveloperOperationError, restoreOrder } from './developerBackup.js';

// Identifiers come only from reviewed table names or live pg_catalog metadata.
const quote = value => `"${value.replaceAll('"', '""')}"`;
const relation = name => `public.${quote(name)}`;
const fail = message => { throw new DeveloperOperationError(message, 409); };
const schemaQuery = `select c.relname as name,
  (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
     'generated',a.attgenerated,'identity',a.attidentity) order by a.attnum)
   from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
  (select jsonb_agg(a.attname order by k.ord) from pg_index i
   cross join lateral unnest(i.indkey) with ordinality k(num,ord)
   join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num where i.indrelid=c.oid and i.indisprimary) as "primaryKey"
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relispartition order by c.relname`;
const foreignKeysQuery = `select child.relname as "table", parent.relname as parent
  from pg_constraint f join pg_class child on child.oid=f.conrelid join pg_namespace cn on cn.oid=child.relnamespace
  join pg_class parent on parent.oid=f.confrelid join pg_namespace pn on pn.oid=parent.relnamespace
  where f.contype='f' and cn.nspname='public' and pn.nspname='public'`;

export function createDeveloperDatabase(sql) {
  return { transaction(mode, operation) {
    return sql.begin(mode === 'read' ? 'isolation level repeatable read read only' : mode === 'backup' ? 'isolation level serializable' : '', async connection => {
      const query = (text, parameters = []) => connection.unsafe(text, parameters);
      await query("set local statement_timeout = '25s'");
      await query("set local lock_timeout = '5s'");
      const metadata = async () => query(schemaQuery);
      async function checkSchema(tables) {
        const live = await metadata();
        for (const table of tables) {
          const current = live.find(item => item.name === table.name);
          if (!current || JSON.stringify(current.columns) !== JSON.stringify(table.columns) ||
            JSON.stringify(current.primaryKey) !== JSON.stringify(table.primaryKey) || !table.primaryKey.length) fail('Database schema changed. Create a fresh backup or use a database-level restore.');
        }
      }
      return operation({
        query,
        async snapshot(createdAt) {
          const live = await metadata();
          const tables = [];
          let total = 0;
          for (const table of live.filter(item => BACKUP_TABLES.includes(item.name))) {
            if (!table.primaryKey?.length) fail('A backup table has no primary key. Use a database-level backup.');
            const count = Number((await query(`select count(*)::int as count from ${relation(table.name)}`))[0].count);
            total += count;
            if (count > MAX_TABLE_ROWS || total > MAX_TOTAL_ROWS) throw new DeveloperOperationError('Dataset exceeds the app backup limit. Use a database-level backup.', 413);
            const rows = await query(`select to_jsonb(t)::text as row from ${relation(table.name)} t order by ${table.primaryKey.map(quote).join(',')}`);
            // JSON text preserves bigint/numeric precision, nulls and raw sensor values.
            tables.push({ ...table, rows: rows.map(row => row.row) });
          }
          return { kind: 'application-backup', version: 1, createdAt, tables,
            excludedTables: live.filter(item => !BACKUP_TABLES.includes(item.name)).map(item => item.name) };
        },
        async lock(tables) {
          // Global ordering prevents competing restores from deadlocking.
          await query(`lock table ${tables.map(table => relation(table.name)).sort().join(',')} in access exclusive mode`);
        },
        async inspectRestore(tables) {
          await checkSchema(tables);
          const summary = [], fingerprints = [];
          for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
            const pk = table.primaryKey;
            const input = `[${table.rows.join(',')}]`;
            // JSON text must travel as text: Postgres.js serializes jsonb parameters
            // again, turning these precision-preserving row arrays into strings.
            const incoming = `jsonb_populate_recordset(null::${relation(table.name)}, $1::text::jsonb)`;
            const invalid = await query(`select count(*)::int as total, count(distinct (${pk.map(key => `i.${quote(key)}`).join(',')}))::int as unique_keys,
              count(*) filter (where ${pk.map(key => `i.${quote(key)} is null`).join(' or ')})::int as null_keys from ${incoming} i`, [input]);
            if (invalid[0].total !== invalid[0].unique_keys || invalid[0].null_keys) fail('Backup contains duplicate or missing primary keys.');
            const joined = `from ${incoming} i left join ${relation(table.name)} c on ${pk.map(key => `c.${quote(key)} = i.${quote(key)}`).join(' and ')}`;
            const [result] = await query(`select
              count(*) filter (where c.${quote(pk[0])} is null)::int as inserted,
              count(*) filter (where c.${quote(pk[0])} is not null and to_jsonb(c) is distinct from to_jsonb(i))::int as updated,
              count(*) filter (where to_jsonb(c) = to_jsonb(i))::int as unchanged,
              coalesce(jsonb_agg(jsonb_build_array(${pk.map(key => `to_jsonb(i.${quote(key)})`).join(',')},to_jsonb(c)) order by ${pk.map(key => `i.${quote(key)}`).join(',')}),'[]'::jsonb)::text as fingerprint
              ${joined}`, [input]);
            const { inserted, updated, unchanged, fingerprint } = result;
            summary.push({ name: table.name, inserted, updated, unchanged });
            fingerprints.push([table.name, fingerprint]);
          }
          return { tables: summary, fingerprint: JSON.stringify(fingerprints) };
        },
        async restore(tables) {
          const ordered = restoreOrder(tables, await query(foreignKeysQuery));
          // Suppress only application triggers, inside the locked transaction.
          // FK/check/unique constraints remain enabled. Preserve each trigger's
          // original mode; rollback also restores every trigger on failure.
          const triggers = await query(`select c.relname as "table", t.tgname as name, t.tgenabled as enabled
            from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and not t.tgisinternal and t.tgenabled <> 'D'`);
          const active = triggers.filter(trigger => tables.some(table => table.name === trigger.table));
          for (const trigger of active) await query(`alter table ${relation(trigger.table)} disable trigger ${quote(trigger.name)}`);
          for (const table of ordered) {
            if (!table.rows.length) continue;
            const columns = table.columns.filter(column => !column.generated).map(column => column.name);
            const updates = columns.filter(column => !table.primaryKey.includes(column));
            const conflict = updates.length ? `do update set ${updates.map(column => `${quote(column)} = excluded.${quote(column)}`).join(',')}
              where (${updates.map(column => `target.${quote(column)}`).join(',')}) is distinct from (${updates.map(column => `excluded.${quote(column)}`).join(',')})` : 'do nothing';
            await query(`insert into ${relation(table.name)} as target (${columns.map(quote).join(',')}) overriding system value
              select ${columns.map(quote).join(',')} from jsonb_populate_recordset(null::${relation(table.name)}, $1::text::jsonb)
              on conflict (${table.primaryKey.map(quote).join(',')}) ${conflict}`, [`[${table.rows.join(',')}]`]);
            for (const column of table.columns.filter(item => item.identity)) {
              const [{ sequence }] = await query('select pg_get_serial_sequence($1, $2) as sequence', [relation(table.name), column.name]);
              if (sequence) await query(`select setval($1::regclass, greatest(coalesce(pg_sequence_last_value($1::regclass),1), coalesce((select max(${quote(column.name)}) from ${relation(table.name)}),1)),true)`, [sequence]);
            }
          }
          for (const trigger of active) {
            const action = trigger.enabled === 'A' ? 'enable always' : trigger.enabled === 'R' ? 'enable replica' : 'enable';
            await query(`alter table ${relation(trigger.table)} ${action} trigger ${quote(trigger.name)}`);
          }
        },
      });
    });
  } };
}
