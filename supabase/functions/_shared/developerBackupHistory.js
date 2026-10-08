import { DeveloperOperationError, EXPORT_ONLY_TABLES, validateArchive } from './developerBackup.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PAGE_SIZE = 20;
const encoder = new TextEncoder();
const toISO = value => new Date(value).toISOString();
const manilaDay = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const itemColumns = `id, created_at::text as "createdAt", backup_day::text as "backupDay", source,
  table_count as "tableCount", record_count as "recordCount", byte_size as "byteSize"`;
const entry = row => ({ id: row.id, createdAt: toISO(row.createdAt), backupDay: row.backupDay,
  source: row.source, tableCount: row.tableCount, recordCount: row.recordCount, byteSize: row.byteSize });

export async function backupContentHash(archive) {
  // Compare data/schema, not the new export timestamp or random encryption IV.
  // Row strings come from canonical PostgreSQL jsonb, preserving numeric precision.
  const data = archive.tables.map(table => ({ name: table.name, columns: table.columns,
    primaryKey: table.primaryKey, rows: [...table.rows].sort() })).sort((a, b) => a.name.localeCompare(b.name));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(data))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function nextDailyBackup(now) {
  const utc = new Date(now);
  utc.setUTCHours(15, 55, 0, 0); // 23:55 Asia/Manila (UTC+8).
  if (utc.getTime() <= now) utc.setUTCDate(utc.getUTCDate() + 1);
  return utc.toISOString();
}

export function createBackupHistory({ database, codec, now = () => Date.now() }) {
  async function download(id) {
    if (!UUID.test(id || '')) throw new DeveloperOperationError('Invalid backup ID.');
    return database.transaction('read', async tx => {
      const [row] = await tx.query(`select ${itemColumns}, payload, summary from craythrive_private.backups where id=$1::uuid`, [id]);
      if (!row) throw new DeveloperOperationError('This backup is not available.', 404);
      return { backup: row.payload, createdAt: toISO(row.createdAt), ...row.summary, historyEntry: entry(row) };
    });
  }
  return {
    download,
    async list(cursor) {
      if (cursor != null && (!cursor || !UUID.test(cursor.id || '') || !Number.isFinite(Date.parse(cursor.createdAt)))) throw new DeveloperOperationError('Invalid history cursor.');
      return database.transaction('read', async tx => {
        const rows = await tx.query(`select ${itemColumns} from craythrive_private.backups
          ${cursor ? 'where (created_at,id) < ($1::timestamptz,$2::uuid)' : ''}
          order by created_at desc,id desc limit ${PAGE_SIZE + 1}`, cursor ? [cursor.createdAt, cursor.id] : []);
        const entries = rows.slice(0, PAGE_SIZE).map(entry);
        const [run] = await tx.query(`select checked_at::text as "checkedAt", source,status,reason
          from craythrive_private.backup_runs order by checked_at desc,id desc limit 1`);
        const [schema] = await tx.query("select to_regclass('cron.job') is not null as installed");
        const enabled = schema.installed && (await tx.query("select exists(select 1 from cron.job where jobname='craythrive-daily-backup' and active) as enabled"))[0].enabled;
        return { entries, nextCursor: rows.length > PAGE_SIZE ? { createdAt: entries.at(-1).createdAt, id: entries.at(-1).id } : null,
          lastRun: run ? { ...run, checkedAt: toISO(run.checkedAt) } : null,
          schedule: { enabled: Boolean(enabled), time: '23:55', timeZone: 'Asia/Manila', nextRunAt: enabled ? nextDailyBackup(now()) : null } };
      });
    },
    async save(source, retry = 0) {
      if (!['manual', 'automatic'].includes(source)) throw new DeveloperOperationError('Invalid backup source.');
      try {
        return await database.transaction('backup', async tx => {
          // One exporter at a time, without blocking ingestion or waiting on another exporter.
          const [{ locked }] = await tx.query('select pg_try_advisory_xact_lock(671846,1) as locked');
          if (!locked) throw new DeveloperOperationError('Another backup is running. Please retry shortly.', 409);
          const archive = await tx.snapshot(new Date(now()).toISOString());
          validateArchive(archive);
          const hash = await backupContentHash(archive);
          const [latest] = await tx.query(`select ${itemColumns}, content_hash as hash from craythrive_private.backups order by created_at desc,id desc limit 1`);
          if (latest?.hash === hash) {
            await tx.query(`insert into craythrive_private.backup_runs(checked_at,source,status,reason,backup_id)
              values ($1,$2,'skipped','no_data_changes',$3::uuid)`, [archive.createdAt, source, latest.id]);
            if (source === 'automatic') return { status: 'skipped', reason: 'no_data_changes' };
            const [stored] = await tx.query('select payload, summary from craythrive_private.backups where id=$1::uuid', [latest.id]);
            return { backup: stored.payload, createdAt: toISO(latest.createdAt), ...stored.summary, historyEntry: entry(latest), status: 'skipped' };
          }
          const backup = await codec.seal(archive);
          const summary = { tables: archive.tables.map(table => ({ name: table.name, rows: table.rows.length, restore: !EXPORT_ONLY_TABLES.includes(table.name) })), excludedTables: archive.excludedTables };
          const records = summary.tables.reduce((sum, table) => sum + table.rows, 0);
          const bytes = encoder.encode(JSON.stringify(backup)).length;
          const [row] = await tx.query(`insert into craythrive_private.backups(created_at,backup_day,source,content_hash,table_count,record_count,byte_size,summary,payload)
            values ($1,$2::date,$3,$4,$5,$6,$7,$8::text::jsonb,$9::text::jsonb) returning ${itemColumns}`,
          [archive.createdAt, manilaDay(now()), source, hash, summary.tables.length, records, bytes, JSON.stringify(summary), JSON.stringify(backup)]);
          await tx.query(`insert into craythrive_private.backup_runs(checked_at,source,status,reason,backup_id)
            values ($1,$2,'saved','data_changed',$3::uuid)`, [archive.createdAt, source, row.id]);
          if (source === 'automatic') return { status: 'saved' }; // Worker never returns an archive or data.
          return { backup, createdAt: archive.createdAt, ...summary, historyEntry: entry(row), status: 'saved' };
        });
      } catch (error) {
        // A serialization retry takes a fresh snapshot after a racing exporter.
        if (error.code === '40001' && retry < 2) return this.save(source, retry + 1);
        if (error instanceof DeveloperOperationError && error.status === 409) throw error;
        // Record only a fixed failure reason, never credentials/provider errors/rows.
        try {
          await database.transaction('write', tx => tx.query(`insert into craythrive_private.backup_runs(checked_at,source,status,reason)
            values ($1,$2,'failed','backup_failed')`, [new Date(now()).toISOString(), source]));
        } catch { /* Deployment/configuration errors may also prevent history writes. */ }
        throw error;
      }
    },
  };
}
