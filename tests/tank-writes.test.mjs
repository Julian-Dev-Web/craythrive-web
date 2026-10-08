import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { tankSpec } from './fixtures/tank-schema.mjs';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, define: {
  'import.meta.env.VITE_SUPABASE_URL': 'undefined',
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
  'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
} });
after(() => server.close());
const { createTanksService } = await server.ssrLoadModule('/src/services/tanksService.js');
const owner = 'verified-user';
const plan = { name: '  New Tank  ', type: 'juvenile', lengthCm: 100, widthCm: 100, heightCm: 60, normalWaterDepthCm: 40, population: 5, shelters: 5, notes: 'Setup notes', user_id: 'forged-owner', water_depth_cm: .6, device_uid: 'forged-device' };

function mockService(spec = tankSpec()) {
  const calls = [], requests = [];
  const state = { authenticated: true, row: { id: 'tank-a', user_id: owner, tank_type: 'juvenile' }, failure: null };
  const client = {
    auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: owner } : null } }), getSession: async () => ({ data: { session: { access_token: 'fake-token' } } }) },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const query = {
        insert(body) { call.method = 'insert'; call.body = body; return query; },
        update(body) { call.method = 'update'; call.body = body; return query; },
        select() { return query; },
        eq(key, value) { call.filters.push([key, value]); return query; },
        async single() {
          if (state.failure) return { error: state.failure };
          const allowed = call.method === 'insert' || call.filters.every(([key, value]) => state.row[key] === value);
          return { data: allowed ? { ...state.row, ...call.body } : null };
        },
      };
      return query;
    },
  };
  const service = createTanksService({ client, url: 'https://qa.supabase.invalid', publicKey: 'qa-public-key', fetcher: async (url, options) => {
    requests.push({ url, options }); return { ok: true, json: async () => spec };
  } });
  return { service, calls, requests, state };
}

test('insert uses verified ownership and only mapped tank fields, never device or measured data', async () => {
  const { service, calls, requests } = mockService();
  await service.save(plan);
  assert.equal(calls.length, 1); assert.equal(calls[0].table, 'tanks');
  assert.equal(calls[0].body.user_id, owner);
  assert.equal(calls[0].body.name, 'New Tank'); assert.equal(calls[0].body.is_paired, false);
  assert.equal(calls[0].body.normal_water_depth_cm, 40);
  assert.ok(!Object.hasOwn(calls[0].body, 'water_depth_cm')); assert.ok(!Object.hasOwn(calls[0].body, 'device_uid'));
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fake-token');
});

test('update filters by owner and primary key and preserves ownership and type', async () => {
  const { service, calls, state } = mockService();
  await service.save({ ...plan, type: 'breeder' }, 'tank-a');
  assert.deepEqual(calls[0].filters, [['id', 'tank-a'], ['user_id', owner]]);
  assert.ok(!Object.hasOwn(calls[0].body, 'user_id')); assert.ok(!Object.hasOwn(calls[0].body, 'tank_type'));
  state.row.user_id = 'other-user';
  await assert.rejects(service.save(plan, 'tank-a'), /could not be saved/);
  await assert.rejects(service.loadForEditing('tank-a'), /permission/);
});

test('validation, unavailable schema, and expired authentication prevent writes', async () => {
  const { service, calls, state } = mockService();
  await assert.rejects(service.save({ ...plan, normalWaterDepthCm: 100 }), /exceed/);
  state.authenticated = false;
  await assert.rejects(service.save(plan), /sign in/);
  assert.equal(calls.length, 0);
  const spec = tankSpec(); delete spec.definitions.tanks.properties.normal_water_depth_cm;
  const unavailable = mockService(spec);
  await assert.rejects(unavailable.service.save(plan), /not available/);
  assert.equal(unavailable.calls.length, 0);
});

test('RLS errors propagate without retrying another table or weaker ownership', async () => {
  const { service, calls, state } = mockService();
  state.failure = { code: '42501', status: 403 };
  await assert.rejects(service.save(plan), error => error.code === '42501');
  assert.equal(calls.length, 1); assert.equal(calls[0].body.user_id, owner);
});

test('existing integer dimensions and text limits produce field errors without rounding or writes', async () => {
  const spec = tankSpec();
  spec.definitions.tanks.properties.length_cm.type = 'integer';
  spec.definitions.tanks.properties.notes.maxLength = 10;
  const { service, calls } = mockService(spec);
  await assert.rejects(service.save({ ...plan, lengthCm: 100.5, notes: 'Much longer than ten' }), error => Boolean(error.fields.lengthCm && error.fields.notes));
  assert.equal(calls.length, 0);
});
