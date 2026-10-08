import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { authorizeDeveloper, createSupabaseTokenVerifier } from '../supabase/functions/_shared/developerAuthorization.js';
import { createDeveloperHandler } from '../supabase/functions/_shared/developerHandlers.js';
import { validatePublicEnv } from '../src/utils/publicConfig.js';

// Synthetic identities only; never the real authorized account.
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const seconds = 1800000000;
const request = (body = {}, authorization = 'Bearer qa-token', method = 'POST') => new Request('https://example.invalid/functions/v1/developer-access', {
  method, headers: authorization ? { Authorization: authorization } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
function fixture() {
  const state = {
    secrets: { CRAYTHRIVE_DEVELOPER_USER_ID: owner },
    user: { id: owner, email: 'owner@example.invalid', email_confirmed_at: '2026-01-01' },
    claims: { sub: owner, role: 'authenticated', aud: 'authenticated', exp: seconds + 3600, aal: 'aal1', amr: [] },
    invalid: false, verifications: [], executions: 0,
  };
  const deps = {
    now: () => seconds * 1000,
    readSecret: name => state.secrets[name],
    verifyToken: async token => { state.verifications.push(token); return state.invalid ? null : { user: state.user, claims: state.claims }; },
    operation: async ({ userId }) => { state.executions++; return { completed: true, userId }; },
  };
  const stepUp = () => { state.claims.aal = 'aal2'; state.claims.amr = [{ method: 'mfa/totp', timestamp: seconds - 1 }]; };
  return { state, deps, stepUp };
}

test('one verified Auth UUID is authorized; no configured identity is returned', async () => {
  const { deps, state } = fixture();
  const response = await createDeveloperHandler({ purpose: 'access', ...deps })(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authorized: true, reauthenticationRequired: true, verifiedUntil: null });
  assert.deepEqual(state.verifications, ['qa-token']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('every other UUID receives identical 403 even with matching email, metadata, role claims or request identity', async () => {
  for (const purpose of ['access', 'backup', 'restore']) {
    const { deps, state, stepUp } = fixture(); stepUp();
    state.user.id = other; state.claims.sub = other;
    state.user.user_metadata = { developer: true, role: 'super_admin', user_id: owner };
    state.claims.app_metadata = { developer: true, role: 'super_admin' };
    const response = await createDeveloperHandler({ purpose, ...deps })(request({ user_id: owner, developer: true, authorized: true, email: state.user.email }));
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { authorized: false });
    assert.equal(state.executions, 0);
  }
});

test('missing/malformed UUID, wildcard and multi-account configurations fail closed', async () => {
  for (const id of [undefined, '', '*', 'owner@example.invalid', owner + ',' + other, JSON.stringify([owner]), 'not-a-uuid']) {
    const { deps, state } = fixture(); state.secrets.CRAYTHRIVE_DEVELOPER_USER_ID = id;
    assert.equal(await authorizeDeveloper(request(), deps), null);
    assert.equal(state.verifications.length, 0);
  }
});

test('email is only a secondary check and cannot authorize a different UUID', async () => {
  const { deps, state } = fixture();
  state.secrets.CRAYTHRIVE_DEVELOPER_EMAIL = 'OWNER@example.invalid';
  assert.ok(await authorizeDeveloper(request(), deps));
  state.user.id = other; state.claims.sub = other;
  assert.equal(await authorizeDeveloper(request(), deps), null);
  state.user.id = owner; state.claims.sub = owner; state.user.email = 'other@example.invalid';
  assert.equal(await authorizeDeveloper(request(), deps), null);
  state.user.email = 'owner@example.invalid'; state.user.email_confirmed_at = null;
  assert.equal(await authorizeDeveloper(request(), deps), null);
});

test('missing bearer, invalid/revoked token, expiry, sub mismatch, anonymous and service keys cannot authorize', async () => {
  for (const authorization of [null, 'qa-token', 'Bearer', 'Bearer token extra']) {
    const { deps } = fixture(); assert.equal(await authorizeDeveloper(request({}, authorization), deps), null);
  }
  for (const mutate of [
    state => { state.invalid = true; },
    state => { state.claims.exp = seconds; },
    state => { state.claims.sub = other; },
    state => { state.user.is_anonymous = true; },
    state => { state.claims.role = 'service_role'; },
    state => { state.claims.aud = 'anon'; },
    state => { state.claims.nbf = seconds + 60; },
  ]) {
    const { deps, state } = fixture(); mutate(state);
    for (const purpose of ['access', 'backup', 'restore']) {
      const response = await createDeveloperHandler({ purpose, ...deps })(request());
      assert.equal(response.status, 403); assert.deepEqual(await response.json(), { authorized: false });
    }
    assert.equal(state.executions, 0);
  }
});

test('Backup/Restore independently require the UUID AND a recent Auth-signed MFA event', async () => {
  for (const purpose of ['backup', 'restore']) {
    for (const amr of [[], ['totp'], [{ method: 'password', timestamp: seconds }], [{ method: 'token_refresh', timestamp: seconds }], [{ method: 'mfa/totp', timestamp: seconds - 301 }], [{ method: 'totp', timestamp: seconds + 60 }]]) {
      const { deps, state } = fixture(); state.claims.aal = 'aal2'; state.claims.amr = amr;
      const response = await createDeveloperHandler({ purpose, ...deps })(request({ verified: true, aal: 'aal2' }));
      assert.equal(response.status, 403); assert.equal(state.executions, 0);
    }
    const { deps, state, stepUp } = fixture();
    let response = await createDeveloperHandler({ purpose, ...deps })(request());
    assert.equal(response.status, 403);
    stepUp(); response = await createDeveloperHandler({ purpose, ...deps })(request());
    assert.equal(response.status, 200); assert.equal(state.executions, 1);
    state.secrets.CRAYTHRIVE_DEVELOPER_USER_ID = other;
    response = await createDeveloperHandler({ purpose, ...deps })(request());
    assert.equal(response.status, 403); assert.equal(state.executions, 1);
  }
});

test('unconfigured operation engines stay disabled after authorization, and failures reveal no provider details', async () => {
  const { deps, stepUp } = fixture(); stepUp();
  for (const purpose of ['backup', 'restore']) {
    const response = await createDeveloperHandler({ ...deps, purpose, operation: undefined })(request());
    assert.equal(response.status, 501);
    const failed = await createDeveloperHandler({ ...deps, purpose, operation: async () => { throw new Error('sensitive database detail'); } })(request());
    assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /sensitive/);
  }
});

test('verifier validates user AND JWT claims using a fresh public-key client per request', async () => {
  const calls = [];
  let invalidUser = false, invalidClaims = false;
  const readSecret = key => ({ SUPABASE_URL: 'https://qa.supabase.invalid', SUPABASE_ANON_KEY: 'public-placeholder' })[key];
  const verify = createSupabaseTokenVerifier((url, key, options) => {
    calls.push({ url, key, options });
    return { auth: {
      async getUser(token) { calls.push(['user', token]); return invalidUser ? { error: {} } : { data: { user: { id: owner } } }; },
      async getClaims(token) { calls.push(['claims', token]); return invalidClaims ? { error: {} } : { data: { claims: { sub: owner } } }; },
    } };
  }, readSecret);
  assert.equal((await verify('token-one')).user.id, owner);
  assert.equal((await verify('token-two')).claims.sub, owner);
  assert.equal(calls.filter(call => call.url).length, 2);
  assert.deepEqual(calls[0].options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  invalidUser = true; assert.equal(await verify('bad-user'), null);
  invalidUser = false; invalidClaims = true; assert.equal(await verify('tampered-signature'), null);
});

test('all deployable endpoints use the shared guard and public builds reject developer configuration', () => {
  for (const purpose of ['access', 'backup', 'restore']) {
    const source = fs.readFileSync(new URL(`../supabase/functions/developer-${purpose}/index.js`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`serveDeveloperFunction\\('${purpose}'\\)`));
  }
  for (const name of ['VITE_CRAYTHRIVE_DEVELOPER_USER_ID', 'VITE_CRAYTHRIVE_DEVELOPER_EMAIL', 'VITE_DEVELOPER_USER_ID']) {
    assert.throws(() => validatePublicEnv({ [name]: owner }), /Unsupported public environment variable/);
  }
  const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.equal((config.match(/verify_jwt = true/g) || []).length, 3);
});
