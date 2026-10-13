import test from 'node:test';
import assert from 'node:assert/strict';
import { readDashboardSession, readDashboardProfile, signOutLocalSession } from '../src/services/dashboardSession.js';
import { hasDashboardAccess } from '../src/utils/dashboardAccess.js';

function fixture(options = {}) {
  const calls = [], user = { id: 'owner' };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: options.absent ? null : { user } }, error: options.sessionError }),
      getUser: async () => ({ data: { user: options.otherUser ? { id: 'other' } : user }, error: options.userError }),
      signOut: async request => { calls.push({ signOut: request }); return {}; },
    },
    from: table => ({ select: () => ({ eq: column => ({ maybeSingle: async () => {
      calls.push({ table, column });
      if (options.throwProfile) throw new Error('network unavailable');
      return { data: options.missingProfile || options.profileError || options.legacy && column === 'id' ? null
        : { id: 'owner', role: options.role || 'user' }, error: options.profileError
          || (options.legacy && column === 'id' ? { code: '42703' } : null) };
    } }) }) }),
  };
  return { client, calls, verify: () => readDashboardSession(client, hasDashboardAccess) };
}

test('restored sessions require a matching verified user and supported owner profile', async () => {
  assert.deepEqual(await fixture().verify(), { status: 'authorized', userId: 'owner' });
  assert.equal((await fixture({ otherUser: true }).verify()).status, 'unavailable');
  assert.equal((await fixture({ absent: true }).verify()).status, 'unauthenticated');
  assert.equal((await readDashboardSession(null, hasDashboardAccess)).status, 'not-configured');
});
test('temporary Auth and profile failures preserve sessions and never call signOut', async () => {
  for (const options of [{ userError: { status: 503 } }, { sessionError: { status: 429 } },
    { userError: { name: 'AuthRetryableFetchError', status: 0 } }, { profileError: { status: 503 } }, { throwProfile: true }]) {
    const f = fixture(options);
    assert.equal((await f.verify()).status, 'unavailable');
    assert.equal(f.calls.filter(call => call.signOut).length, 0);
  }
});
test('definitively invalid sessions are denied while profile denial never revokes another device', async () => {
  for (const userError of [{ status: 401 }, { name: 'AuthSessionMissingError' }, { code: 'refresh_token_not_found' }]) {
    assert.equal((await fixture({ userError }).verify()).status, 'unauthenticated');
  }
  for (const options of [{ role: 'unsupported' }, { missingProfile: true }]) {
    const f = fixture(options);
    assert.equal((await f.verify()).status, 'forbidden');
    assert.equal(f.calls.filter(call => call.signOut).length, 0);
  }
});
test('legacy profile fallback is limited to missing rows/columns and does not multiply outage requests', async () => {
  const legacy = fixture({ legacy: true });
  assert.equal((await legacy.verify()).status, 'authorized');
  assert.deepEqual(legacy.calls.map(call => call.column), ['id', 'user_id']);
  const offline = fixture({ profileError: { status: 503 } });
  assert.equal((await readDashboardProfile(offline.client, 'owner')).status, 'unavailable');
  assert.equal(offline.calls.length, 1);
});
test('local signOut removes only the current SDK session in an independent-session contract', async () => {
  const validSessions = new Set(['web-session', 'mobile-session']);
  const clientFor = id => ({ auth: { signOut: async ({ scope }) => {
    assert.equal(scope, 'local'); validSessions.delete(id); return {};
  } } });
  await signOutLocalSession(clientFor('web-session'));
  assert.equal(validSessions.has('web-session'), false);
  assert.equal(validSessions.has('mobile-session'), true);
});
