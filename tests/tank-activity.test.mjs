import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';
import { buildTankActivity, formatRecordedPumpAction } from '../supabase/functions/_shared/tankActivity.js';

const tank = { id: 'tank-a', user_id: 'owner', name: 'Tank A' };
const date = '2026-10-11T02:00:00Z';
const row = (id, patch = {}) => ({ id, user_id: 'owner', tank_id: 'tank-a', created_at: date, ...patch });
const history = sources => buildTankActivity({ tank, userId: 'owner', sources });
const server = await createServer({ server: { middlewareMode: true, hmr: false } });
after(() => server.close());
const { loadTankActivity } = await server.ssrLoadModule('/src/services/tankActivityService.js');

test('saved command status determines presentation without acknowledgement wording or timestamps', () => {
  const items = history({ device_commands: [
    row('pending', { command_type: 'FEED_ONCE', command_status: 'pending', result_message: 'completed' }),
    row('default', { command_type: 'REFILL_FOR', command_status: 'done' }),
    row('fake', { command_type: 'REFILL_FOR', command_status: 'done', metadata: { execution_confirmed: true, confirmation_source: 'device' } }),
    row('ack', { command_type: 'REFILL_FOR', command_status: 'done', executed_at: date, result_message: 'REFILL_FOR completed for 2000 ms. Safe water check.' }),
    row('running', { command_status: 'running' }), row('skip', { command_status: 'rejected', result_message: 'Water level too low' }),
    row('failed', { command_status: 'failed' }),
  ] });
  const byId = id => items.find(item => item.id.endsWith(`:${id}`));
  assert.equal(byId('pending').outcome, 'Pending Verification');
  assert.equal(byId('default').outcome, 'Completed');
  assert.equal(byId('fake').outcome, 'Completed');
  assert.equal(byId('ack').outcome, 'Completed');
  assert.equal(byId('ack').result, 'The actuator action completed.');
  assert.equal(byId('running').outcome, 'In Progress');
  assert.equal(byId('skip').outcome, 'Rejected');
  assert.equal(byId('skip').reason, 'Water level too low');
  assert.equal(byId('failed').outcome, 'Failed');
});

test('raw automation and fallback command mirrors honor their own saved status fields', () => {
  const items = history({ tank_automation_logs: [row('auto-a', { action_type: 'AUTO_REFILL', action_status: 'done', reason: 'Automatic water-level correction pulse completed.', water_status: 'LOW_WARNING' }),
    row('auto-b', { action_type: 'AUTO_REFILL', action_status: 'done' }), row('auto-skip', { action_type: 'AUTO_FEED', action_status: 'skipped', reason: 'Critical pH' })],
  device_commands: [row('mirror', { command_type: 'REFILL_FOR', command_value: 'auto', command_status: 'done', executed_at: date, result_message: 'Automatic water assist: correction | Auto log id: auto-a' })] });
  assert.equal(items.length, 3);
  assert.equal(items.find(item => item.id.endsWith(':auto-a')).outcome, 'Completed');
  assert.equal(items.find(item => item.id.endsWith(':auto-b')).outcome, 'Completed');
  assert.equal(items.find(item => item.id.endsWith(':auto-skip')).outcome, 'Skipped');
  const mirror = history({ device_commands: [row('mirror', { command_value: 'auto', command_type: 'REFILL_FOR', command_status: 'done', executed_at: date, result_message: 'Automatic water assist: correction | Auto log id: absent' })] });
  assert.equal(mirror[0].outcome, 'Completed');
});

test('recorded pump wording honors done without acknowledgement and never displays requested drain runtime', () => {
  const sources = { device_commands: [
    row('drain', { command_type: 'DRAIN_FOR', command_status: 'done', executed_at: date, duration_ms: 10000,
      result_message: 'DRAIN_FOR completed for 250 ms. Safety check passed.' }),
    row('refill', { command_type: 'REFILL_FOR', command_status: 'done', executed_at: date, duration_ms: 10000,
      result_message: 'REFILL_FOR completed for 1000 ms. Safety check passed.' }),
    row('unknown', { command_type: 'DRAIN_FOR', command_status: 'done', duration_ms: 10000 }),
  ] };
  const before = structuredClone(sources);
  const events = history(sources);
  const drain = events.find(event => event.id.endsWith(':drain'));
  assert.equal(drain.reason, 'The drain pump was activated.');
  assert.doesNotMatch(JSON.stringify(drain), /250|10000|seconds/);
  assert.equal(events.find(event => event.id.endsWith(':refill')).reason, 'The refill pump ran for 1 second.');
  assert.equal(formatRecordedPumpAction(sources.device_commands[2]).title, 'Drain completed');
  assert.equal(events.find(event => event.id.endsWith(':unknown')).outcome, 'Completed');
  assert.deepEqual(sources, before);
});

test('history preserves saved sensor evidence and only reuses generic inspection guidance', () => {
  const source = { alerts: [row('ph', { type: 'sensor_reading', title: 'Low pH warning', message: 'pH was 6.4', severity: 'warning',
    metadata: { parameter: 'ph', sensor_snapshot: { value: 6.4, thresholds: { phMin: 6.5, phMax: 8.5 } } } }),
    row('temp', { type: 'sensor_reading', title: 'Critical high temperature', severity: 'critical', message: 'Temperature was high' })] };
  const before = JSON.stringify(source);
  const items = history(source);
  assert.equal(items.find(item => item.parameter === 'ph').threshold, 'Safe Range: 6.5–8.5');
  assert.equal(items.find(item => item.parameter === 'ph').reading, '6.4');
  assert.equal(items.find(item => item.parameter === 'temperature').threshold, null);
  assert.match(items.find(item => item.parameter === 'ph').recommendation, /Repeat the pH test/);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(history(source), items);
});

test('handled alerts are not invented recoveries; explicit backend recovery is distinct', () => {
  const items = history({ alerts: [row('handled', { type: 'sensor_reading', title: 'Low pH warning', severity: 'warning', status: 'resolved', resolved_at: date }),
    row('recovered', { type: 'sensor_recovery', title: 'pH recovered', severity: 'normal' })] });
  assert.match(items.find(item => item.id.endsWith(':handled')).result, /not independently recorded/);
  assert.match(items.find(item => item.id.endsWith(':recovered')).result, /recovery event was recorded/);
});

test('an orphan action notification uses its saved command status rather than its title', () => {
  const items = history({ alerts: [row('orphan', { title: 'Add Water completed', command_id: 'unavailable',
    metadata: { command_type: 'REFILL_FOR', command_status: 'done' } })] });
  assert.equal(items[0].title, 'Manual water refill');
  assert.equal(items[0].outcome, 'Completed');
});

test('deduplicates source IDs and explicit command/control/ammonia alert links without inventing event correlations', () => {
  const command = row('command', { command_type: 'FEED_ONCE', command_status: 'pending' });
  const items = history({ device_commands: [command, command], control_logs: [row('control', { action_type: 'threshold_updated', notes: 'Water Level Minimum: 4 → 5', metadata: { source: 'manual' } })],
    ammonia_readings: [row('scan', { ammonia_mg_l: 0 })], alerts: [row('command-alert', { command_id: 'command' }),
      row('control-alert', { metadata: { control_log_id: 'control' } }), row('scan-alert', { type: 'ammonia_reading', severity: 'warning', metadata: { ammonia_reading_id: 'scan' } })] });
  assert.equal(items.length, 3);
  assert.equal(items.find(item => item.category === 'ammonia').reading, '0 mg/L');
  assert.equal(items.find(item => item.category === 'ammonia').severity, 'warning');
  assert.equal(items.find(item => item.category === 'thresholds').outcome, 'Completed');
});

test('same-tank owner scope is mandatory and chronological order uses saved instants', () => {
  const sources = { control_logs: [row('old', { created_at: '2026-10-10T15:59:59Z' }), row('new', { created_at: '2026-10-10T16:00:00Z' }),
    row('invalid', { created_at: '2026-10-12 10:00:00' }), row('foreign', { user_id: 'another' }), row('other-tank', { tank_id: 'tank-b' })] };
  assert.deepEqual(history(sources).map(item => item.id), ['control_logs:new', 'control_logs:old', 'control_logs:invalid']);
  assert.match(history(sources)[0].timestampLabel, /Oct 11, 2026/);
  assert.deepEqual(buildTankActivity({ tank, userId: 'another', sources }), []);
});

function client({ denied = false, failSource, missing = false, repeated = false, rpcError = null, automationRows } = {}) {
  const calls = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    rpc: async (name, args) => { calls.push({ name, args }); return rpcError ? { error: rpcError } : missing ? { error: { code: 'PGRST202' } } : { data: [] }; },
    from(source) {
      const call = { source, filters: [] }; calls.push(call);
      const q = {};
      for (const method of ['select', 'eq', 'or', 'gte', 'lt', 'order', 'range']) q[method] = (...args) => { call.filters.push({ method, args }); return q; };
      q.maybeSingle = async () => ({ data: denied ? null : tank });
      q.then = (resolve, reject) => {
        const range = call.filters.find(filter => filter.method === 'range')?.args || [0, 99];
        const data = source === 'tank_automation_logs' && automationRows ? automationRows.slice(range[0], range[1] + 1)
          : repeated ? Array.from({ length: 100 }, (_, i) => row(`r-${i}`)) : [row(source)];
        return Promise.resolve(source === failSource ? { error: { code: '42501' } } : { data }).then(resolve, reject);
      };
      return q;
    } };
}

test('loader verifies tank ownership and filters each source by owner, tank and Philippine date before paging', async () => {
  const fake = client();
  const loaded = await loadTankActivity(fake, { tankId: 'tank-a', fromDate: '2026-10-11', toDate: '2026-10-11' });
  assert.equal(loaded.events.length, 4);
  for (const call of fake.calls.filter(call => call.source && call.source !== 'tanks')) {
    for (const [method, args] of [['eq', ['user_id', 'owner']], ['eq', ['tank_id', 'tank-a']],
      ['gte', ['created_at', '2026-10-10T16:00:00.000Z']], ['lt', ['created_at', '2026-10-11T16:00:00.000Z']]]) {
      assert.ok(call.filters.some(filter => filter.method === method && JSON.stringify(filter.args) === JSON.stringify(args)));
    }
  }
  const denied = client({ denied: true });
  await assert.rejects(loadTankActivity(denied, { tankId: 'tank-a' }), /verified/);
  assert.equal(denied.calls.length, 1);
});

test('loader preserves partial verified history, falls back for missing RPC, rejects repeated pages and never writes', async () => {
  const fake = client({ failSource: 'alerts', missing: true });
  const loaded = await loadTankActivity(fake, { tankId: 'tank-a' });
  assert.equal(loaded.events.length, 4);
  assert.equal(loaded.notices.length, 1);
  const direct = fake.calls.find(call => call.source === 'tank_automation_logs');
  assert.ok(direct.filters.some(filter => filter.method === 'or' && filter.args[0] === 'user_id.eq.owner,user_id.is.null'));
  const repeat = await loadTankActivity(client({ repeated: true }), { tankId: 'tank-a' });
  assert.equal(repeat.events.length, 0);
  assert.equal(repeat.notices.length, 4);
  await assert.rejects(loadTankActivity(fake, { tankId: 'tank-a', fromDate: '2026-10-12', toDate: '2026-10-11' }), /start date/);
});

test('a missing RPC is not polled repeatedly; explicit refresh can recheck deployment', async () => {
  const fake = client({ missing: true });
  await loadTankActivity(fake, { tankId: 'tank-a' });
  await loadTankActivity(fake, { tankId: 'tank-a' });
  assert.equal(fake.calls.filter(call => call.name === 'get_tank_automation_history').length, 1);
  await loadTankActivity(fake, { tankId: 'tank-a', recheckAutomation: true });
  assert.equal(fake.calls.filter(call => call.name === 'get_tank_automation_history').length, 2);
});

test('direct automation fallback pages existing logs and keeps pulses, table-ID collisions, saved reasons and ownerless rows', async () => {
  const automated = Array.from({ length: 101 }, (_, index) => row(`pulse-${index}`, {
    action_type: index % 2 ? 'AUTO_REFILL' : 'AUTO_DRAIN', action_status: 'done', duration_seconds: 5,
    reason: 'before=2.96 cm, after=3.70 cm, delta=0.74 cm.', user_id: index === 0 ? null : 'owner',
  }));
  const fake = client({ missing: true, automationRows: automated });
  const loaded = await loadTankActivity(fake, { tankId: tank.id, fromDate: '2026-10-11', toDate: '2026-10-11' });
  assert.equal(loaded.events.filter(event => event.source === 'tank_automation_logs').length, 101);
  assert.equal(fake.calls.filter(call => call.source === 'tank_automation_logs').length, 2);
  assert.equal(fake.calls.filter(call => call.name === 'get_tank_automation_history').length, 1);
  assert.deepEqual(loaded.notices, []);
  const events = history({ device_commands: [row('same-id', { command_type: 'REFILL_FOR', command_status: 'done' })],
    tank_automation_logs: [row('same-id', { action_type: 'AUTO_REFILL', action_status: 'done' }),
      row('second-pulse', { action_type: 'AUTO_REFILL', action_status: 'done' })] });
  assert.equal(events.length, 3); assert.equal(new Set(events.map(event => event.id)).size, 3);
});
test('an explicit automation RPC authorization or network error never falls back to another read path', async () => {
  for (const code of ['42501', 'PGRST301', '503']) {
    const fake = client({ rpcError: { code } });
    const loaded = await loadTankActivity(fake, { tankId: tank.id });
    assert.equal(fake.calls.some(call => call.source === 'tank_automation_logs'), false);
    assert.match(loaded.notices.join(' '), /Automation history could not be verified/);
  }
  const fake = client({ missing: true, failSource: 'tank_automation_logs' });
  const loaded = await loadTankActivity(fake, { tankId: tank.id });
  assert.match(loaded.notices.join(' '), /Automation history could not be verified/);
  assert.equal(loaded.events.some(event => event.source === 'tank_automation_logs'), false);
});
test('ownerless source logs belong only to their verified tank and independent sensor alerts are never discarded as mirrors', () => {
  const log = row('auto', { action_type: 'AUTO_REFILL', action_status: 'done', user_id: null });
  const events = history({ tank_automation_logs: [log, { ...log, id: 'foreign', user_id: 'other' }, { ...log, id: 'other-tank', tank_id: 'tank-b' }],
    alerts: [row('independent', { type: 'sensor_reading', title: 'Low pH', metadata: { tank_automation_log_id: 'auto' } })] });
  assert.deepEqual(events.map(event => event.id).sort(), ['alerts:independent', 'tank_automation_logs:auto']);
});

test('review SQL enforces owner-checked history and authenticated restrictive read policies without touching device writes', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const tankId = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      CREATE TABLE public.tanks(id uuid PRIMARY KEY,user_id uuid);
      CREATE TABLE public.control_logs(id uuid,user_id uuid,tank_id uuid,created_at timestamptz);
      CREATE TABLE public.device_commands(id uuid,user_id uuid,tank_id text,created_at timestamptz);
      CREATE TABLE public.tank_automation_logs(id uuid,user_id uuid,tank_id uuid,created_at timestamptz);
      ALTER TABLE control_logs ENABLE ROW LEVEL SECURITY; ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;
      CREATE POLICY broad ON control_logs FOR SELECT TO authenticated USING(true);
      CREATE POLICY broad ON device_commands FOR SELECT TO authenticated USING(true);
      GRANT SELECT ON tanks,control_logs,device_commands TO authenticated;
      INSERT INTO tanks VALUES ('${tankId}','${owner}');
      INSERT INTO tank_automation_logs VALUES ('33333333-3333-4333-8333-333333333333','${owner}','${tankId}','2026-10-11T02:00:00Z');
      INSERT INTO control_logs VALUES ('33333333-3333-4333-8333-333333333333','${owner}','${tankId}',now()),
      ('44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','${tankId}',now());`);
    await db.exec(fs.readFileSync('docs/sql/20261011190000_tank_activity_history_review.sql', 'utf8'));
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';`);
    assert.equal((await db.query(`SELECT * FROM get_tank_automation_history('${tankId}')`)).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM control_logs')).rows.length, 1);
    await assert.rejects(db.query(`SELECT * FROM get_tank_automation_history('66666666-6666-4666-8666-666666666666')`), /ownership/);
    await assert.rejects(db.query(`SELECT * FROM get_tank_automation_history('${tankId}',NULL,NULL,0,1000)`), /Invalid history/);
    await db.exec(`SET request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';`);
    await assert.rejects(db.query(`SELECT * FROM get_tank_automation_history('${tankId}')`), /ownership/);
    assert.equal((await db.query('SELECT * FROM control_logs')).rows.length, 0);
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(db.query(`SELECT * FROM get_tank_automation_history('${tankId}')`), /permission denied/);
  } finally { await db.close(); }
});
