import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_AMOUNTS, normalizeDispenseCycles, recordedDispenseCycles, isPairedFeedActuator, formatRecordedFeedingAction } from '../supabase/functions/_shared/feederControl.js';
import { buildTankActivity, getRecordedActionOutcome } from '../supabase/functions/_shared/tankActivity.js';

test('only 1/2/3 are selectable; invalid values fall back to two without inventing historical cycles', () => {
  assert.deepEqual(FEED_AMOUNTS.map(option => option.cycles), [1, 2, 3]);
  for (const value of [1, 2, 3, '1', '2', '3']) assert.equal(normalizeDispenseCycles(value), Number(value));
  for (const value of [0, -1, 1.5, 3.1, 4, null, undefined, NaN, Infinity, true, false, '', 'once', 'auto', '3.0', {}, []]) {
    assert.equal(normalizeDispenseCycles(value), 2);
    assert.equal(recordedDispenseCycles(value), null);
  }
});

test('feeding requires a claimed actuator belonging to this owner and paired tank', () => {
  const tank = { id: 'tank-a', user_id: 'owner', device_uid: 'sensor-a' };
  const device = { device_uid: 'actuator-a', tank_id: 'tank-a', user_id: 'owner', device_type: 'actuator_hub', is_claimed: true };
  assert.equal(isPairedFeedActuator(device, tank, tank.id), true);
  for (const patch of [{ device_type: 'sensor_hub' }, { tank_id: 'tank-b' }, { user_id: 'other' }, { is_claimed: false }, { is_claimed: undefined }, { device_uid: '' }, { tank_id: null }]) {
    assert.equal(isPairedFeedActuator({ ...device, ...patch }, tank, tank.id), false);
  }
  assert.equal(isPairedFeedActuator({ ...device, tank_id: null }, { ...tank, actuator_device_uid: device.device_uid }, tank.id), true);
  assert.equal(isPairedFeedActuator({ ...device, tank_id: 'tank-b' }, { ...tank, actuator_device_uid: device.device_uid }, tank.id), false);
});

test('pending, running, rejected, failed and unacknowledged done never claim feeding completion', () => {
  for (const [status, expected] of [['pending', 'Requested'], ['running', 'Started'], ['rejected', 'Rejected'], ['blocked', 'Rejected'], ['failed', 'Failed'], ['done', 'Unknown / Unconfirmed']]) {
    const command = { command_type: 'FEED_ONCE', command_value: 3, command_status: status };
    const result = formatRecordedFeedingAction(command, getRecordedActionOutcome(command));
    assert.equal(result.outcome, expected);
    assert.equal(result.cycles, 3);
    assert.doesNotMatch(result.title, /completed/);
  }
  const command = { command_type: 'FEED_ONCE', command_value: '2', command_status: 'done', executed_at: '2026-10-17T02:00:00Z', result_message: 'FEED_ONCE completed.' };
  const before = structuredClone(command);
  assert.match(formatRecordedFeedingAction(command, getRecordedActionOutcome(command)).message, /Feeding completed — 2 dispense cycles/);
  assert.deepEqual(command, before);
  assert.equal(formatRecordedFeedingAction({ ...command, command_value: 'once' }, 'Completed').cycles, null);
  assert.equal(formatRecordedFeedingAction({ command_type: 'REFILL_FOR' }, 'Completed'), null);
});

test('manual/scheduled history uses recorded cycle counts and preserves raw historical statuses', () => {
  const tank = { id: 'tank-a', user_id: 'owner' };
  const row = { id: 'manual', tank_id: tank.id, user_id: tank.user_id, created_at: '2026-10-17T02:00:00Z', command_type: 'FEED_ONCE', command_value: 3, command_status: 'rejected', result_message: 'Unsafe pH' };
  const sources = { device_commands: [row, { ...row, id: 'legacy', command_value: 'once' }],
    tank_automation_logs: [{ ...row, id: 'scheduled', command_type: undefined, action_type: 'SCHEDULED_FEED', command_value: '2', action_status: 'skipped' }] };
  const before = structuredClone(sources);
  const history = buildTankActivity({ tank, userId: tank.user_id, sources });
  assert.equal(history.find(event => event.id === 'device_commands:manual').dispenseCycles, 3);
  assert.equal(history.find(event => event.id === 'device_commands:manual').outcome, 'Rejected');
  assert.equal(history.find(event => event.id === 'device_commands:legacy').dispenseCycles, null);
  assert.equal(history.find(event => event.id === 'tank_automation_logs:scheduled').dispenseCycles, 2);
  assert.deepEqual(sources, before);
});
