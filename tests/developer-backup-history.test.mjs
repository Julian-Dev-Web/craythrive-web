import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createDeveloperDatabase } from '../supabase/functions/_shared/developerDatabase.js';
import { createArchiveCodec, createBackupOperation } from '../supabase/functions/_shared/developerBackup.js';
import { backupContentHash, createBackupHistory, nextDailyBackup } from '../supabase/functions/_shared/developerBackupHistory.js';
import { createScheduledBackupHandler } from '../supabase/functions/_shared/developerBackupScheduler.js';
import { postgresWireParameters } from './helpers/postgres-wire.mjs';

const migration = await readFile(new URL('../supabase/migrations/20261008150000_developer_backup_history.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key, name text); insert into profiles values('${owner}','QA Farmer');
    create table sensor_readings(id bigint primary key, water_depth_cm numeric);
    insert into sensor_readings values(9007199254740993,0.600000000000000001);`);
  await pg.exec(migration);
  const sql = { begin: (options, callback) => pg.transaction(async tx => {
    if (options) await tx.exec(`set transaction ${options}`);
    return callback({ unsafe: async (text, args) => (await tx.query(text, postgresWireParameters(text, args))).rows });
  }) };
  const database = createDeveloperDatabase(sql);
  const codec = createArchiveCodec({ secret: 'ab'.repeat(32), project: 'https://qa.supabase.invalid' });
  let time = Date.parse('2026-10-08T15:55:00Z');
  const now = () => time;
  const history = createBackupHistory({ database, codec, now });
  return { pg, database, codec, now, history, advance: ms => { time += ms; } };
}

test('daily check saves first baseline, skips unchanged days, and saves changed/deleted data only', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.history.save('automatic'), { status: 'saved' });
  const first = await f.history.list();
  assert.equal(first.entries.length, 1); assert.equal(first.entries[0].backupDay, '2026-10-08');
  f.advance(86400000);
  assert.deepEqual(await f.history.save('automatic'), { status: 'skipped', reason: 'no_data_changes' });
  assert.equal((await f.history.list()).entries.length, 1);
  assert.equal((await f.history.list()).lastRun.status, 'skipped');
  await f.pg.exec("update profiles set name='Changed farmer'");
  f.advance(86400000); await f.history.save('automatic');
  await f.pg.exec('delete from sensor_readings');
  f.advance(86400000); await f.history.save('automatic');
  const result = await f.history.list();
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0].recordCount, 1);
  assert.equal(result.lastRun.status, 'saved');
  const rows = (await f.pg.query('select payload::text from craythrive_private.backups')).rows;
  assert.ok(rows.every(row => !/Farmer|Changed farmer|water_depth_cm|9007199254740993/.test(row.payload)));
});

test('manual exports join history; unchanged downloads reuse the saved archive and date', async t => {
  const f = await fixture(t);
  const first = await f.history.save('manual');
  f.advance(60000);
  const again = await f.history.save('manual');
  assert.equal(first.status, 'saved'); assert.equal(again.status, 'skipped');
  assert.deepEqual(first.backup, again.backup); assert.equal(first.createdAt, again.createdAt);
  assert.equal((await f.history.list()).entries.length, 1);
  assert.deepEqual(await f.history.save('automatic'), { status: 'skipped', reason: 'no_data_changes' });
  const stored = await f.history.download(first.historyEntry.id);
  const archive = await f.codec.open(stored.backup);
  assert.match(archive.tables.find(table => table.name === 'sensor_readings').rows[0], /0.600000000000000001/);
  const request = new Request('https://qa.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'download', id: first.historyEntry.id }) });
  assert.deepEqual((await createBackupOperation({ purpose: 'backup', ...f })({ request, userId: owner })).backup, first.backup);
});

test('production JSON serialization and legacy normalization preserve encrypted archives and numeric precision', async t => {
  const f = await fixture(t);
  const first = await f.history.save('manual');
  const before = (await f.pg.query('select jsonb_typeof(payload) as payload, jsonb_typeof(summary) as summary from craythrive_private.backups')).rows[0];
  assert.deepEqual(before, { payload: 'object', summary: 'object' });
  // Reproduce the old driver's wire encoding rather than bypassing it in PGlite.
  const query = 'update craythrive_private.backups set payload=$1::jsonb, summary=$2::jsonb';
  const summary = { tables: first.tables, excludedTables: first.excludedTables };
  await f.pg.query(query, postgresWireParameters(query, [JSON.stringify(first.backup), JSON.stringify(summary)]));
  assert.equal((await f.pg.query('select jsonb_typeof(payload) as type from craythrive_private.backups')).rows[0].type, 'string');
  const repair = await readFile(new URL('../supabase/migrations/20261008151000_normalize_backup_json.sql', import.meta.url), 'utf8');
  await f.pg.exec(repair); await f.pg.exec(repair); // Idempotent; no re-encryption.
  const stored = await f.history.download(first.historyEntry.id);
  assert.deepEqual(stored.backup, first.backup); assert.deepEqual(stored.tables, first.tables);
  assert.equal(stored.createdAt, first.createdAt);
  const archive = await f.codec.open(stored.backup);
  assert.match(archive.tables.find(table => table.name === 'sensor_readings').rows[0], /0.600000000000000001/);
  assert.match(archive.tables.find(table => table.name === 'sensor_readings').rows[0], /9007199254740993/);
});

test('history pagination is stable when new backups arrive; IDs and cursors are validated', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 25; i++) {
    await f.pg.query('update profiles set name=$1', [`Name ${i}`]); f.advance(60000);
    await f.history.save('automatic');
  }
  const first = await f.history.list();
  assert.equal(first.entries.length, 20); assert.ok(first.nextCursor);
  await f.pg.exec("update profiles set name='Newer backup'"); f.advance(60000); await f.history.save('manual');
  const second = await f.history.list(first.nextCursor);
  assert.equal(second.entries.length, 5); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.entries, ...second.entries].map(item => item.id)).size, 25);
  await assert.rejects(f.history.list({ id: 'bad', createdAt: 'yesterday' }), /cursor/);
  await assert.rejects(f.history.download("';drop table profiles;--"), /ID/);
  await assert.rejects(f.history.download('99999999-9999-4999-8999-999999999999'), error => error.status === 404);
});

test('failure records only a fixed reason and never leaves a partial or plaintext archive', async t => {
  const f = await fixture(t);
  const failing = createBackupHistory({ ...f, codec: { seal: async () => { throw new Error('provider-secret-do-not-record'); } } });
  await assert.rejects(failing.save('automatic'));
  assert.equal((await f.history.list()).entries.length, 0);
  const runs = (await f.pg.query('select * from craythrive_private.backup_runs')).rows;
  assert.equal(runs[0].status, 'failed'); assert.equal(runs[0].reason, 'backup_failed');
  assert.doesNotMatch(JSON.stringify(runs), /provider-secret/);
});

test('encrypted history is inaccessible to anon/authenticated/service roles and excluded from snapshots', async t => {
  const f = await fixture(t); await f.history.save('automatic');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const [{ schema, table }] = (await f.pg.query(`select has_schema_privilege($1,'craythrive_private','USAGE') as schema,
      has_table_privilege($1,'craythrive_private.backups','SELECT') as "table"`, [role])).rows;
    assert.equal(schema, false); assert.equal(table, false);
  }
  await f.pg.exec('set role authenticated');
  await assert.rejects(f.pg.query('select * from craythrive_private.backups'), /permission denied/);
  await f.pg.exec('reset role');
  const archive = await f.codec.open((await f.history.download((await f.history.list()).entries[0].id)).backup);
  assert.deepEqual(archive.tables.map(table => table.name).sort(), ['profiles', 'sensor_readings']);
});

test('fingerprints ignore export time/order, but retain actual row and schema changes', async () => {
  const archive = { createdAt: 'old', tables: [{ name: 'profiles', columns: [{ name: 'id' }], primaryKey: ['id'], rows: ['{"id":1}', '{"id":2}'] }] };
  const reordered = structuredClone(archive); reordered.createdAt = 'new'; reordered.tables[0].rows.reverse();
  assert.equal(await backupContentHash(archive), await backupContentHash(reordered));
  reordered.tables[0].rows[0] = '{"id":3}';
  assert.notEqual(await backupContentHash(archive), await backupContentHash(reordered));
  reordered.tables[0].rows = archive.tables[0].rows; reordered.tables[0].columns.push({ name: 'added' });
  assert.notEqual(await backupContentHash(archive), await backupContentHash(reordered));
});

test('daily status uses the actual enabled cron job and 23:55 Manila boundary', async t => {
  const f = await fixture(t);
  assert.equal((await f.history.list()).schedule.enabled, false);
  await f.pg.exec("create schema cron; create table cron.job(jobname text, active boolean); insert into cron.job values('craythrive-daily-backup',true)");
  assert.equal((await f.history.list()).schedule.enabled, true);
  assert.equal(nextDailyBackup(Date.parse('2026-10-08T15:54:59Z')), '2026-10-08T15:55:00.000Z');
  assert.equal(nextDailyBackup(Date.parse('2026-10-08T15:55:00Z')), '2026-10-09T15:55:00.000Z');
  await f.pg.exec('update cron.job set active=false');
  assert.equal((await f.history.list()).schedule.enabled, false);
});

test('export-only scheduler rejects user JWTs, missing/wrong credentials, and reveals no archive', async () => {
  let calls = 0;
  const time = 1791468000000;
  const headers = (key = 'ab'.repeat(32), timestamp = String(time)) => ({
    'x-craythrive-backup-timestamp': timestamp,
    'x-craythrive-backup-signature': createHmac('sha256', Buffer.from(key, 'hex')).update(`craythrive-daily-backup:v1:${timestamp}`).digest('hex'),
  });
  const handler = createScheduledBackupHandler({ readSecret: () => 'ab'.repeat(32), now: () => time, save: async source => {
    calls++; assert.equal(source, 'automatic'); return { status: 'saved', backup: 'never-return-this', secret: 'never-return-this' };
  } });
  for (const invalid of [{}, { Authorization: 'Bearer user-jwt' }, { 'x-craythrive-backup-token': 'ab'.repeat(32) },
    headers('cd'.repeat(32)), headers(undefined, String(time - 120001)), headers(undefined, String(time + 120001))]) {
    assert.equal((await handler(new Request('https://qa.invalid', { method: 'POST', headers: invalid }))).status, 403);
  }
  assert.equal(calls, 0);
  const request = new Request('https://qa.invalid', { method: 'POST', headers: headers(), body: '{"action":"restore","table":"auth.users"}' });
  const response = await handler(request);
  assert.deepEqual(await response.json(), { status: 'saved' }); assert.equal(calls, 1);
  const missingConfig = createScheduledBackupHandler({ readSecret: () => '', save: async () => { throw new Error(); } });
  assert.equal((await missingConfig(new Request('https://qa.invalid', { method: 'POST' }))).status, 403);
  const failure = createScheduledBackupHandler({ readSecret: () => 'ab'.repeat(32), now: () => time, save: async () => { throw new Error('private provider details'); } });
  const failed = await failure(new Request('https://qa.invalid', { method: 'POST', headers: headers() }));
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private provider/);
});
