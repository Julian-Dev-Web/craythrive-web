// Server-only: encrypted application-data archives, never Auth credentials.
export const BACKUP_TABLES = Object.freeze([
  'alerts', 'ammonia_readings', 'camera_registry', 'control_logs', 'device_commands',
  'devices', 'iot_devices', 'marketplace_chat_messages', 'marketplace_chat_threads',
  'marketplace_listings', 'marketplace_orders', 'notification_preferences', 'profiles',
  'push_tokens', 'seller_profiles', 'sensor_readings', 'tank_automation_logs',
  'tank_automation_settings', 'tank_threshold_settings', 'tanks', 'threshold_settings', 'turbidity_readings', 'water_thresholds',
]);
// Never reactivate historical actuator work, automation configuration or push recipients.
export const EXPORT_ONLY_TABLES = Object.freeze(['device_commands', 'push_tokens', 'tank_automation_settings']);
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export const MAX_TABLE_ROWS = 20000;
export const MAX_TOTAL_ROWS = 50000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const format = 'craythrive-backup';

export class DeveloperOperationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new DeveloperOperationError(message, status); };
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);

function toBase64(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
function fromBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('Invalid backup file.');
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
async function digest(value) {
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export function createArchiveCodec({ secret, project }) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '') || !project) fail('Backup server configuration is incomplete.', 503);
  const keyPromise = crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g), part => parseInt(part, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const additionalData = encoder.encode(`CrayThrive backup v1:${project}`);
  return {
    async seal(value) {
      const bytes = encoder.encode(JSON.stringify(value));
      if (bytes.length > MAX_ARCHIVE_BYTES) fail('Backup exceeds the 8 MB limit. Use a database-level backup for this dataset.', 413);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, await keyPromise, bytes);
      return { format, version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
    },
    async open(envelope) {
      try {
        if (!plainObject(envelope) || envelope.format !== format || envelope.version !== 1 ||
          typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > Math.ceil((MAX_ARCHIVE_BYTES + 16) / 3) * 4) throw new Error();
        const iv = fromBase64(envelope.iv);
        if (iv.length !== 12) throw new Error();
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, await keyPromise, fromBase64(envelope.ciphertext));
        return JSON.parse(decoder.decode(plaintext));
      } catch { fail('This backup is invalid, modified, or belongs to another project/key.'); }
    },
  };
}

export async function readOperationBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail('Send a JSON request.', 415);
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) fail('Backup file is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('Missing request body.');
  let text = '', length = 0;
  const streamDecoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) { await reader.cancel(); fail('Backup file is too large.', 413); }
      text += streamDecoder.decode(value, { stream: true });
    }
    text += streamDecoder.decode();
    const body = JSON.parse(text);
    if (!plainObject(body)) fail('Invalid request.');
    return body;
  } catch (error) {
    if (error instanceof DeveloperOperationError) throw error;
    fail('Invalid JSON request.');
  } finally { reader.releaseLock(); }
}

export function validateArchive(archive) {
  if (!plainObject(archive) || archive.kind !== 'application-backup' || archive.version !== 1 ||
    !Array.isArray(archive.tables) || !archive.tables.length || archive.tables.length > BACKUP_TABLES.length ||
    !Number.isFinite(Date.parse(archive.createdAt))) fail('Unsupported backup contents.');
  const seen = new Set();
  let total = 0;
  for (const table of archive.tables) {
    if (!plainObject(table) || !BACKUP_TABLES.includes(table.name) || seen.has(table.name) ||
      !Array.isArray(table.rows) || table.rows.length > MAX_TABLE_ROWS || !Array.isArray(table.columns) || !Array.isArray(table.primaryKey)) fail('Unsupported backup table.');
    seen.add(table.name); total += table.rows.length;
    const names = table.columns.map(column => column.name).sort();
    for (const raw of table.rows) {
      let row;
      try { row = typeof raw === 'string' ? JSON.parse(raw) : null; } catch { fail('Invalid backup row.'); }
      if (!plainObject(row) || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(names)) fail('Backup columns do not match.');
    }
  }
  if (total > MAX_TOTAL_ROWS) fail('Backup exceeds the supported row limit.', 413);
}

export function restoreOrder(tables, foreignKeys) {
  const remaining = new Map(tables.map(table => [table.name, table]));
  const result = [];
  while (remaining.size) {
    const ready = [...remaining.keys()].filter(name => !foreignKeys.some(key => key.table === name && key.parent !== name && remaining.has(key.parent))).sort();
    if (!ready.length) fail('This database has cyclic relationships that require a database-level restore.');
    for (const name of ready) { result.push(remaining.get(name)); remaining.delete(name); }
  }
  return result;
}

export function createBackupOperation({ purpose, database, codec, history, now = () => Date.now() }) {
  return async ({ request, userId }) => {
    const body = await readOperationBody(request);
    if (purpose === 'backup') {
      if (history && body.action === 'history') return history.list(body.cursor);
      if (history && body.action === 'download') return history.download(body.id);
      if (body.action !== 'export') fail('Unsupported backup action.');
      if (history) return history.save('manual');
      return database.transaction('read', async tx => {
        const archive = await tx.snapshot(new Date(now()).toISOString());
        validateArchive(archive);
        return { backup: await codec.seal(archive), createdAt: archive.createdAt,
          tables: archive.tables.map(table => ({ name: table.name, rows: table.rows.length, restore: !EXPORT_ONLY_TABLES.includes(table.name) })), excludedTables: archive.excludedTables };
      });
    }
    if (!['preview', 'apply'].includes(body.action)) fail('Unsupported restore action.');
    const archive = await codec.open(body.backup);
    validateArchive(archive);
    const backupDigest = await digest(JSON.stringify(body.backup));
    const selected = archive.tables.filter(table => !EXPORT_ONLY_TABLES.includes(table.name));
    if (!selected.length) fail('This backup contains no restorable tables.');
    if (body.action === 'preview') {
      return database.transaction('read', async tx => {
        const state = await tx.inspectRestore(selected);
        // A separate encrypted recovery copy is downloaded before confirmation.
        const recovery = await tx.snapshot(new Date(now()).toISOString());
        const expiresAt = Math.floor(now() / 1000) + 120;
        const previewToken = await codec.seal({ kind: 'restore-preview', userId, backupDigest, stateDigest: await digest(state.fingerprint), expiresAt });
        return { createdAt: archive.createdAt, tables: state.tables, skippedTables: archive.tables.filter(table => EXPORT_ONLY_TABLES.includes(table.name)).map(table => table.name),
          expiresAt, previewToken, recoveryBackup: await codec.seal(recovery) };
      });
    }
    if (body.confirmation !== 'RESTORE') fail('Type RESTORE to confirm.');
    const proof = await codec.open(body.previewToken);
    if (proof.kind !== 'restore-preview' || proof.userId !== userId || proof.backupDigest !== backupDigest ||
      !Number.isFinite(proof.expiresAt) || proof.expiresAt <= now() / 1000) fail('Restore preview expired or changed. Preview the backup again.', 409);
    return database.transaction('write', async tx => {
      // Locks are transaction-scoped, including while checking the preview state.
      await tx.lock(selected);
      const state = await tx.inspectRestore(selected);
      if (await digest(state.fingerprint) !== proof.stateDigest) fail('Affected records changed after preview. Preview the backup again.', 409);
      await tx.restore(selected);
      return { restored: true, tables: state.tables, completedAt: new Date(now()).toISOString() };
    });
  };
}
