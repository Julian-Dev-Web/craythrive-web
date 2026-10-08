import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, define: {
  'import.meta.env.VITE_SUPABASE_URL': 'undefined',
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
  'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
} });
after(() => server.close());
const { createDeveloperService } = await server.ssrLoadModule('/src/services/developerService.js');

function fixture() {
  const calls = [];
  const state = { token: 'qa-session', allowed: false, verified: false, confirmOtp: true, qrCode: 'data:image/svg+xml;utf-8,<svg />', factors: { totp: [{ id: 'factor', status: 'verified' }], all: [] } };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.token ? { access_token: state.token } : null } }),
      mfa: {
        async listFactors() { calls.push(['list']); return { data: state.factors }; },
        async enroll(options) { calls.push(['enroll', options]); return { data: { id: 'new-factor', totp: { qr_code: state.qrCode } } }; },
        async unenroll(options) { calls.push(['unenroll', options]); return {}; },
        async challengeAndVerify(options) { calls.push(['verify', options]); state.verified = state.confirmOtp; state.token = 'qa-upgraded-session'; return {}; },
      },
    },
    functions: { async invoke(name, options) {
      calls.push(['function', name, options]);
      return { data: state.allowed ? { authorized: true, reauthenticationRequired: !state.verified, verifiedUntil: state.verified ? Date.now() / 1000 + 300 : null } : { authorized: false } };
    } },
  };
  return { calls, state, service: createDeveloperService(client) };
}

test('current session token is sent to server without identity, email, role or authorization flags', async () => {
  const { service, state, calls } = fixture(); state.allowed = true;
  assert.equal((await service.checkAccess()).reauthenticationRequired, true);
  assert.deepEqual(calls[0], ['function', 'developer-access', { body: {}, headers: { Authorization: 'Bearer qa-session' } }]);
  state.token = null; await assert.rejects(service.checkAccess()); assert.equal(calls.length, 1);
});

test('unauthorized sessions never start factor lookup, enrollment or OTP verification', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.beginVerification());
  await assert.rejects(service.beginVerification(true));
  await assert.rejects(service.verifyOtp('factor', '123456'));
  assert.ok(calls.every(call => call[0] === 'function'));
});

test('verification uses Auth MFA and then asks server to validate the newly issued token', async () => {
  const { service, state, calls } = fixture(); state.allowed = true;
  assert.equal((await service.beginVerification()).factorId, 'factor');
  const access = await service.verifyOtp('factor', '123456');
  assert.equal(access.reauthenticationRequired, false);
  assert.deepEqual(calls.at(-1)[2].headers, { Authorization: 'Bearer qa-upgraded-session' });
  assert.ok(calls.some(call => call[0] === 'verify'));
});

test('authenticator setup is explicit and only cleans up this account’s unverified developer enrollment', async () => {
  const { service, state, calls } = fixture(); state.allowed = true;
  state.factors = { totp: [], all: [
    { id: 'pending', factor_type: 'totp', status: 'unverified', friendly_name: 'CrayThrive Developer' },
    { id: 'other', factor_type: 'totp', status: 'unverified', friendly_name: 'Other app' },
  ] };
  assert.equal((await service.beginVerification()).factorId, null);
  assert.ok(!calls.some(call => call[0] === 'enroll'));
  assert.equal((await service.beginVerification(true)).factorId, 'new-factor');
  assert.deepEqual(calls.filter(call => call[0] === 'unenroll'), [['unenroll', { factorId: 'pending' }]]);
});

test('invalid OTP input and unconfirmed server step-up do not unlock Developer Mode', async () => {
  const { service, state, calls } = fixture(); state.allowed = true;
  await assert.rejects(service.verifyOtp('factor', '123'));
  assert.ok(!calls.some(call => call[0] === 'verify'));
  state.confirmOtp = false;
  await assert.rejects(service.verifyOtp('factor', '123456'), /could not be confirmed/);
});

test('enrollment normalizes raw and SDK-prefixed SVG without double-wrapping or losing colors', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" /></svg>';
  const expected = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const base64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  for (const qrCode of [svg, `data:image/svg+xml;utf-8,${svg}`, expected, base64]) {
    const { service, state } = fixture();
    state.allowed = true; state.factors = { totp: [], all: [] }; state.qrCode = qrCode;
    assert.equal((await service.beginVerification(true)).qrCode, qrCode === base64 ? base64 : expected);
  }
});

test('enrollment rejects missing QR images and remote image URLs', async () => {
  for (const qrCode of [null, '', 'https://example.invalid/qr.svg']) {
    const { service, state } = fixture();
    state.allowed = true; state.factors = { totp: [], all: [] }; state.qrCode = qrCode;
    await assert.rejects(service.beginVerification(true));
  }
});

test('backup/restore calls send only the archive/action/proof with the current session JWT', async () => {
  const { service, state, calls } = fixture(); state.allowed = true;
  await service.exportBackup();
  const backup = { format: 'craythrive-backup', version: 1, ciphertext: 'qa-only' };
  await service.previewRestore(backup);
  state.token = 'fresh-operation-token';
  await service.applyRestore(backup, 'server-proof', 'RESTORE');
  assert.deepEqual(calls.filter(call => call[0] === 'function').map(call => [call[1], call[2].body]), [
    ['developer-backup', { action: 'export' }],
    ['developer-restore', { action: 'preview', backup }],
    ['developer-restore', { action: 'apply', backup, previewToken: 'server-proof', confirmation: 'RESTORE' }],
  ]);
  assert.deepEqual(calls.at(-1)[2].headers, { Authorization: 'Bearer fresh-operation-token' });
  state.token = null;
  await assert.rejects(service.exportBackup());
});

test('history/download use the same authenticated developer endpoint without exposing a scheduler token', async () => {
  const { service, state, calls } = fixture(); state.allowed = true;
  await service.listBackupHistory();
  const cursor = { id: 'qa-id', createdAt: '2026-10-08T00:00:00Z' };
  await service.listBackupHistory(cursor); await service.downloadStoredBackup('qa-id');
  assert.deepEqual(calls.map(call => call[2].body), [
    { action: 'history' }, { action: 'history', cursor }, { action: 'download', id: 'qa-id' },
  ]);
  assert.ok(calls.every(call => call[1] === 'developer-backup'));
  assert.doesNotMatch(JSON.stringify(calls), /scheduler|service_role/i);
});
