// Machine-only export worker. This credential never authorizes developer access,
// history downloads or restore. The existing developer endpoints still require UUID + MFA.
export function createScheduledBackupHandler({ readSecret, save, now = () => Date.now() }) {
  return async request => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    const expected = readSecret('CRAYTHRIVE_BACKUP_SCHEDULER_TOKEN') || '';
    const signature = request.headers.get('x-craythrive-backup-signature') || '';
    const timestamp = request.headers.get('x-craythrive-backup-timestamp') || '';
    // pg_net queues are readable by database login roles. Send only a short-lived
    // HMAC, never the reusable Vault/Edge secret. User JWTs/flags do not qualify.
    if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(signature)
      || !/^\d{13}$/.test(timestamp) || Math.abs(now() - Number(timestamp)) > 120000) return json({ authorized: false }, 403);
    const bytes = hex => Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
    const key = await crypto.subtle.importKey('raw', bytes(expected), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, bytes(signature), new TextEncoder().encode(`craythrive-daily-backup:v1:${timestamp}`))) return json({ authorized: false }, 403);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    // No caller-selected action, table, SQL, URL, archive or restore behavior.
    try {
      const result = await save('automatic');
      return json({ status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
    } catch { return json({ error: 'Scheduled backup could not be completed.' }, 503); }
  };
}
