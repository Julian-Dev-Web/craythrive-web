import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createTankSchemaHandler } from '../server/tankSchemaHandler.js';
import { hasDashboardAccess } from '../src/utils/dashboardAccess.js';
import { tankSpec } from './fixtures/tank-schema.mjs';

function fixture() {
  const env = { VITE_SUPABASE_URL: 'https://qa.supabase.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'example_server_only_key' };
  const state = { authenticated: true, profile: { id: 'owner', role: 'user' }, schema: tankSpec(), rootStatus: 200, requests: [], profileColumn: 'id' };
  const fetcher = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = Object.fromEntries(new Headers(options?.headers));
    state.requests.push({ path: url.pathname, params: url.searchParams, headers });
    if (state.networkFailure) throw new Error('private-provider-detail');
    if (url.pathname === '/auth/v1/user') return Response.json(state.authenticated ? { id: 'owner' } : { message: 'private-auth-detail' }, { status: state.authenticated ? 200 : state.authStatus || 401 });
    if (url.pathname === '/rest/v1/profiles') {
      if (state.profileFailure) return Response.json({ message: 'private-profile-detail' }, { status: 503 });
      return Response.json(url.searchParams.get(state.profileColumn) === 'eq.owner' ? state.profile : null);
    }
    assert.equal(url.pathname, '/rest/v1/');
    if (state.invalidJson) return new Response('private-provider-detail');
    return Response.json(state.schema, { status: state.rootStatus });
  };
  const handler = createTankSchemaHandler({ env, fetcher });
  async function invoke({ method = 'GET', authorization = 'Bearer example_user_session', operation = 'create' } = {}) {
    const response = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
    await handler({ method, url: `/api/tank-schema?operation=${operation}`, headers: { authorization } }, response);
    return response;
  }
  return { env, state, handler, invoke };
}

test('API verifies the caller with public key/RLS and returns only a narrow schema contract', async () => {
  const { invoke, state, env } = fixture();
  state.schema.definitions.private_table = { properties: { internal: { description: 'private-metadata-marker' } } };
  state.schema.definitions.tanks.properties.notes.description = 'private-metadata-marker';
  const response = await invoke();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.userId, 'owner');
  assert.equal(response.body.contract.fields.normalWaterDepthCm, 'normal_water_depth_cm');
  const body = JSON.stringify(response.body);
  for (const value of ['private-metadata-marker', 'gen_random_uuid', 'device_uid', env.SUPABASE_SECRET_KEY, 'example_user_session', 'private_table']) assert.equal(body.includes(value), false);
  assert.deepEqual(response.body.contract.properties.is_paired, { type: 'boolean' });
  for (const request of state.requests.filter(request => request.path !== '/rest/v1/')) {
    assert.equal(request.headers.apikey, env.VITE_SUPABASE_PUBLISHABLE_KEY);
    assert.equal(request.headers.authorization, 'Bearer example_user_session');
  }
  const root = state.requests.find(request => request.path === '/rest/v1/');
  assert.equal(root.headers.apikey, env.SUPABASE_SECRET_KEY);
  assert.equal(root.headers.authorization, undefined);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
});

test('missing or expired authentication never reaches privileged metadata', async () => {
  const { invoke, state } = fixture();
  assert.equal((await invoke({ authorization: '' })).statusCode, 401);
  assert.equal(state.requests.length, 0);
  state.authenticated = false;
  const response = await invoke();
  assert.equal(response.statusCode, 401); assert.equal(response.body.code, 'TANK_AUTH_REQUIRED');
  assert.ok(!state.requests.some(request => request.path === '/rest/v1/'));
});

test('dashboard role is required and supports the same profile aliases as the browser', async () => {
  const { invoke, state } = fixture();
  state.profile = { role: 'admin' };
  assert.equal((await invoke()).statusCode, 403);
  assert.ok(!state.requests.some(request => request.path === '/rest/v1/'));
  state.profile = { user_role: ' User ' }; state.profileColumn = 'user_id';
  assert.equal((await invoke()).statusCode, 200);
  for (const profile of [null, {}, { role: 'super_admin' }, { role: 'authenticated' }]) assert.equal(hasDashboardAccess(profile), false);
  assert.equal(hasDashboardAccess({ account_role: 'user' }), true);
});

test('missing server key and rejected schema credentials are setup errors, never expired sign-in', async () => {
  const { invoke, state, env } = fixture();
  delete env.SUPABASE_SECRET_KEY;
  let response = await invoke();
  assert.equal(response.statusCode, 503); assert.equal(response.body.code, 'TANK_SERVER_SETUP_REQUIRED');
  assert.ok(!state.requests.some(request => request.path === '/rest/v1/'));
  env.SUPABASE_SERVICE_ROLE_KEY = 'example_legacy_server_key';
  assert.equal((await invoke()).statusCode, 200);
  for (const status of [401, 403]) {
    state.rootStatus = status; response = await invoke();
    assert.equal(response.statusCode, 503); assert.equal(response.body.code, 'TANK_SCHEMA_ACCESS_DENIED');
    assert.equal(JSON.stringify(response.body).includes(env.SUPABASE_SERVICE_ROLE_KEY), false);
  }
});

test('network, provider outages, rate limits and invalid JSON do not ask users to sign in again', async () => {
  for (const overrides of [{ networkFailure: true }, { profileFailure: true }, { authenticated: false, authStatus: 429 }, { invalidJson: true }, { rootStatus: 500 }]) {
    const { state, invoke } = fixture(); Object.assign(state, overrides);
    const response = await invoke();
    assert.equal(response.statusCode, 503); assert.equal(response.body.code, 'TANK_SCHEMA_UNAVAILABLE');
    assert.equal(JSON.stringify(response.body).includes('private-'), false);
  }
});

test('API validates method, operation and public configuration before contacting providers', async () => {
  const { invoke, state, env } = fixture();
  assert.equal((await invoke({ method: 'POST' })).statusCode, 405);
  assert.equal((await invoke({ operation: 'delete' })).statusCode, 400);
  env.VITE_SUPABASE_URL = 'https://example.invalid?token=forbidden';
  assert.equal((await invoke()).body.code, 'TANK_CONFIG_MISSING');
  assert.equal(state.requests.length, 0);
});

test('schema compatibility errors return controlled codes/field labels without SQL or provider details', async () => {
  const { invoke, state } = fixture();
  delete state.schema.definitions.tanks.properties.normal_water_depth_cm;
  const response = await invoke();
  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.body, { code: 'TANK_FIELDS_MISSING', fields: ['normalWaterDepthCm'] });
  state.schema = tankSpec(); delete state.schema.paths['/tanks'].patch;
  assert.equal((await invoke()).statusCode, 200);
  assert.equal((await invoke({ operation: 'edit' })).body.code, 'TANK_EDIT_NOT_ALLOWED');
});

test('Node function serves authenticated JSON over HTTP, not the SPA fallback', async () => {
  const { handler } = fixture();
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tank-schema?operation=create`, { headers: { Authorization: 'Bearer example_user_session' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).contract.primaryKey, 'id');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Vite development serves the same protected API instead of returning index.html', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, ws: false }, logLevel: 'silent' });
  try {
    await server.listen();
    const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/api/tank-schema`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).code, 'TANK_AUTH_REQUIRED');
  } finally { await server.close(); }
});
