import { randomBytes } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Uses an existing CLI login. Sends only this new worker credential, never
// exports other project secrets. No values are printed or put in command args.
const project = process.argv[2];
const executable = process.env.SUPABASE_CLI_PATH || 'supabase';
if (!/^[a-z0-9]{20}$/.test(project || '')) throw new Error('Supply the intended Supabase project ref.');
const envFile = new URL('../supabase/functions/.env.backup-scheduler', import.meta.url);
const sqlFile = new URL('../.security-backup-schedule-secret.sql', import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
let token;
try {
  const content = await readFile(envFile, 'utf8');
  const match = /^CRAYTHRIVE_BACKUP_SCHEDULER_TOKEN=([a-f0-9]{64})\s*$/.exec(content);
  if (!match) throw new Error('Existing scheduler key file is invalid.');
  token = match[1];
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  token = randomBytes(32).toString('hex');
  await writeFile(envFile, `CRAYTHRIVE_BACKUP_SCHEDULER_TOKEN=${token}\n`, { flag: 'wx', mode: 0o600 });
}
const cli = args => execFileSync(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
try {
  // Refuse to replace an existing Vault credential with a different value.
  // The secret appears only in this ignored, temporary SQL file and provider request.
  await writeFile(sqlFile, `begin;
    do $$ declare existing text; begin
      select decrypted_secret into existing from vault.decrypted_secrets where name='craythrive_backup_scheduler_token';
      if found then
        if existing <> '${token}' then raise exception 'Refusing scheduler credential rotation'; end if;
      else perform vault.create_secret('${token}','craythrive_backup_scheduler_token','CrayThrive export-only worker'); end if;
    end $$;
    insert into craythrive_private.backup_schedule_config(singleton,worker_url)
      values(true,'https://${project}.supabase.co/functions/v1/developer-backup-scheduled')
      on conflict(singleton) do update set worker_url=excluded.worker_url;
    commit;`, { mode: 0o600 });
  cli(['db', 'query', '--linked', '--project-ref', project, '--file', fileURLToPath(sqlFile)]);
  cli(['secrets', 'set', '--project-ref', project, '--env-file', fileURLToPath(envFile)]);
  cli(['db', 'query', '--linked', '--project-ref', project, '--file', 'supabase/schedules/developer-backup.sql']);
  console.log('Configured daily backup at 23:55 Asia/Manila. Worker credential remains server-only.');
} catch {
  console.error('Backup schedule setup failed. Review provider configuration; no credentials were printed.');
  process.exitCode = 1;
} finally { await unlink(sqlFile).catch(() => {}); }
