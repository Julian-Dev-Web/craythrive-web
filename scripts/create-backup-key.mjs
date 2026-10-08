import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Run once for a new project. Never rotate an existing archive key implicitly.
const path = new URL('../supabase/functions/.env.backup', import.meta.url);
try {
  const content = await readFile(path, 'utf8');
  if (!/^CRAYTHRIVE_BACKUP_ENCRYPTION_KEY=[a-f0-9]{64}\s*$/i.test(content)) throw new Error('Existing backup key file is invalid. Review it without printing its contents.');
  console.log('Existing ignored backup key retained. No key was rotated.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(path, `CRAYTHRIVE_BACKUP_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created server-only backup key in ignored supabase/functions/.env.backup.');
}
