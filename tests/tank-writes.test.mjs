import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, define: {
  'import.meta.env.VITE_SUPABASE_URL': 'undefined',
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
  'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
} });
after(() => server.close());
const { createTanksService } = await server.ssrLoadModule('/src/services/tanksService.js');
const owner = 'verified-user';
const form = { name: '  Breeder Tank 1  ', type: 'breeder', juvenileCount: '20', notes: '  Notes  ', user_id: 'forged-user', has_paired_device: true, male_count: 99, status: 'Normal', water_depth_cm: .6 };

function mockService() {
  const calls = [];
  const state = { authenticated: true, failure: null, returned: {}, authCalls: 0 };
  const client = {
    auth: { async getUser() { state.authCalls++; return { data: { user: state.authenticated ? { id: owner } : null } }; } },
    from(table) {
      const call = { table }; calls.push(call);
      const query = {
        insert(body) { call.body = body; return query; },
        select(columns) { call.select = columns; return query; },
        async single() { return state.failure ? { error: state.failure } : { data: { id: 'tank-created', ...call.body, ...state.returned } }; },
      };
      return query;
    },
  };
  return { service: createTanksService({ client }), calls, state };
}

test('one insert uses verified auth owner and only columns in supplied public.tanks DDL', async () => {
  const { service, calls, state } = mockService();
  const result = await service.create(form);
  assert.equal(state.authCalls, 1); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { table: 'tanks', select: '*', body: {
    user_id: owner, tank_name: 'Breeder Tank 1', tank_type: 'Breeder', male_count: 1, female_count: 2, juvenile_count: 0,
    notes: 'Notes', has_paired_device: false, status: 'Unpaired',
  } });
  assert.equal(result.tank.id, result.id);
});

test('juvenile uses same table/ownership with zero breeder counters and selected count', async () => {
  const { service, calls } = mockService();
  const result = await service.create({ ...form, type: 'juvenile', juvenileCount: '20' });
  assert.equal(result.tank.tank_type, 'Juvenile');
  assert.equal(calls[0].body.juvenile_count, 20);
  assert.equal(calls[0].body.male_count, 0); assert.equal(calls[0].body.female_count, 0);
});

test('invalid forms and absent auth never insert', async () => {
  const { service, calls, state } = mockService();
  await assert.rejects(service.create({ ...form, name: '  ' }), error => error.code === 'TANK_FORM_INVALID');
  await assert.rejects(service.create({ ...form, type: 'juvenile', juvenileCount: '15.5' }), error => error.code === 'TANK_FORM_INVALID');
  assert.equal(state.authCalls, 0);
  state.authenticated = false;
  await assert.rejects(service.create(form), error => error.code === 'TANK_AUTH_REQUIRED');
  assert.equal(calls.length, 0);
});

test('RLS rejection is preserved with no fallback insert or ownership change', async () => {
  const { service, calls, state } = mockService();
  state.failure = { code: '42501', message: 'RLS rejection' };
  await assert.rejects(service.create(form), error => error === state.failure);
  assert.equal(calls.length, 1); assert.equal(calls[0].body.user_id, owner);
});

test('returned row must confirm owner, type, numeric population and unpaired state', async () => {
  for (const returned of [{ user_id: 'other-owner' }, { tank_type: 'breeder' }, { juvenile_count: 10 }, { male_count: 2 }, { female_count: 1 }, { has_paired_device: true }, { id: null }]) {
    const { service, state, calls } = mockService(); state.returned = returned;
    await assert.rejects(service.create(form), error => error.code === 'TANK_RESULT_UNCONFIRMED');
    assert.equal(calls.length, 1);
  }
});

test('missing public connection fails safely without a schema endpoint or server secret', async () => {
  await assert.rejects(createTanksService({ client: null }).create(form), error => error.code === 'TANK_CONFIG_MISSING');
});
