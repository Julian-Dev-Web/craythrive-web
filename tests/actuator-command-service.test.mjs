import test from 'node:test';
import assert from 'node:assert/strict';
import { insertActuatorCommand, actuatorCommandErrorMessage } from '../src/services/actuatorCommandService.js';

const payload = (type = 'FEED_ONCE') => ({
  user_id: 'owner-a', tank_id: 'tank-a', device_uid: 'actuator-a',
  command_type: type, command_source: 'manual', command_status: 'pending', status: 'pending',
  command_value: type === 'FEED_ONCE' ? 2 : type === 'RESET_FEED_LOCK' ? 'reset' : 'on',
  duration_ms: type.endsWith('_FOR') ? 1000 : 0,
});
function fixture({ probeError = null, insertError = null, returned = null, probe = null } = {}) {
  const calls = [], inserts = [];
  const client = { from(table) {
    assert.equal(table, 'device_commands');
    const query = {
      select(columns) { calls.push(['select', columns]); return query; },
      eq(column, value) { calls.push(['eq', column, value]); return query; },
      limit(count) { calls.push(['limit', count]); return query; },
      insert(body) { inserts.push(body); return query; },
      single() { return query; },
      async abortSignal(signal) {
        calls.push(['signal', signal]);
        if (!inserts.length) return probe ? probe(signal) : { data: probeError ? null : [], error: probeError };
        return { data: insertError ? null : { id: 'real-command-id', ...inserts.at(-1), ...returned }, error: insertError };
      },
    };
    return query;
  } };
  return { client, inserts, calls };
}

for (const code of ['42703', 'PGRST204']) {
  for (const type of ['FEED_ONCE', 'REFILL_FOR', 'DRAIN_FOR', 'RESET_FEED_LOCK']) {
    test(`${type}: old schema ${code} omits only optional metadata and inserts exactly once`, async () => {
      const f = fixture({ probeError: { code, message: 'column device_commands.command_source does not exist' } });
      const before = payload(type), original = structuredClone(before);
      const row = await insertActuatorCommand(f.client, before);
      const expected = { ...before }; delete expected.command_source;
      assert.deepEqual(f.inserts, [expected]); assert.deepEqual(before, original);
      assert.equal(row.id, 'real-command-id'); assert.equal(row.command_status, 'pending');
      assert.deepEqual(f.calls.slice(0, 5), [['select', 'command_source'], ['eq', 'user_id', before.user_id],
        ['eq', 'tank_id', before.tank_id], ['eq', 'device_uid', before.device_uid], ['limit', 0]]);
    });
  }
}
test('modern schema retains source, cycles, duration and scope; no capability cache survives a schema change', async () => {
  const f = fixture();
  await insertActuatorCommand(f.client, payload());
  assert.deepEqual(f.inserts, [payload()]);
  const old = fixture({ probeError: { code: '42703', message: 'column command_source does not exist' } });
  await insertActuatorCommand(old.client, payload());
  assert.equal(Object.hasOwn(old.inserts[0], 'command_source'), false);
  const modern = fixture(); await insertActuatorCommand(modern.client, payload());
  assert.equal(modern.inserts[0].command_source, 'manual');
});
for (const error of [
  { code: '42501', message: 'RLS rejection' },
  { code: 'PGRST301', message: 'Invalid authentication' },
  { code: '42703', message: 'column other_column does not exist' },
  { code: 'PGRST204', message: 'schema cache has no other_column' },
  { message: 'Network failure' },
]) test(`probe failure ${error.code || 'network'} never enqueues a command or bypasses permissions`, async () => {
  const f = fixture({ probeError: error });
  await assert.rejects(insertActuatorCommand(f.client, payload()), actual => actual === error);
  assert.equal(f.inserts.length, 0);
});
for (const error of [
  { code: '42501', message: 'RLS rejection' },
  { code: '55000', message: 'Emergency stop is active; resume required' },
  { code: '55000', message: 'Another action is running' },
  { code: 'PGRST204', message: 'column command_source does not exist' },
  { message: 'Response lost after command insert' },
]) test(`insert failure ${error.code || 'network'} preserves error and never retries`, async () => {
  const f = fixture({ insertError: error });
  await assert.rejects(insertActuatorCommand(f.client, payload()), actual => actual === error);
  assert.equal(f.inserts.length, 1);
});
test('a mismatched server response never establishes success or causes another insert', async () => {
  const f = fixture({ returned: { tank_id: 'another-tank' } });
  await assert.rejects(insertActuatorCommand(f.client, payload()), /could not be verified/);
  assert.equal(f.inserts.length, 1);
});
test('Stop/Resume and malformed requests cannot use this ordinary command path', async () => {
  for (const body of [payload('STOP_ALL'), payload('RESUME_CONTROLS'), { ...payload(), user_id: '' }, { ...payload(), command_status: 'done' }]) {
    const f = fixture(); await assert.rejects(insertActuatorCommand(f.client, body), /Invalid pending/);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.inserts, []);
  }
});
test('a timed-out probe cannot later dispatch a physical command', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  const f = fixture({ probe: () => new Promise(resolve => { release = resolve; }) });
  const pending = insertActuatorCommand(f.client, payload());
  const rejected = assert.rejects(pending, /verification timed out/);
  t.mock.timers.tick(10001); await rejected;
  release({ data: [], error: null }); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.inserts.length, 0);
});
test('a timed-out insert is unconfirmed and never retried', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const f = fixture();
  const client = { from(...args) {
    const query = f.client.from(...args), original = query.abortSignal;
    query.abortSignal = signal => ++count === 1 ? original(signal) : new Promise(() => {});
    return query;
  } };
  const pending = insertActuatorCommand(client, payload());
  const rejected = assert.rejects(pending, /could not be confirmed.*Refresh actuator state/);
  await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(10001); await rejected;
  assert.equal(f.inserts.length, 1);
});
test('friendly errors distinguish safety, permissions and incomplete schema without exposing raw error detail', () => {
  assert.match(actuatorCommandErrorMessage({ code: '55000', message: 'Emergency stop is active' }), /explicitly Resume/);
  assert.match(actuatorCommandErrorMessage({ code: '55000', message: 'Another action is running' }), /Another actuator action/);
  assert.match(actuatorCommandErrorMessage({ code: 'PGRST204', message: 'command_source' }), /metadata schema/);
  assert.match(actuatorCommandErrorMessage({ code: '42501', message: 'private details' }), /permission/);
  assert.equal(actuatorCommandErrorMessage({ message: 'private details' }, 'Unconfirmed'), 'Unconfirmed');
});
