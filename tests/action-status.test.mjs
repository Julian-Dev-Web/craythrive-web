import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecordedActionStatus, getActionStatusPresentation } from '../supabase/functions/_shared/actionStatus.js';
import { buildTankActivity, getRecordedActionOutcome, formatRecordedPumpAction } from '../supabase/functions/_shared/tankActivity.js';

const reason = 'controlled exchange drain verified: before=3.21 cm, after=2.10 cm, delta=-1.11 cm. Expected water decrease confirmed.';
const tank = { id: 'tank-a', user_id: 'owner', name: 'Tank A' };
const record = { id: 'verified', tank_id: tank.id, user_id: tank.user_id, created_at: '2026-10-19T02:00:00Z' };

test('all requested status mappings apply to automation, commands and control logs', () => {
  for (const [status, expected] of [
    ['done', 'Completed'], ['completed', 'Completed'], ['rechecking', 'Executed – Rechecking'],
    ['blocked', 'Blocked'], ['skipped', 'Skipped'], ['failed', 'Failed'], ['rejected', 'Rejected'],
    ['running', 'In Progress'], ['pending', 'Pending Verification'], [null, 'Unknown / Unconfirmed'], ['genuinely_unknown', 'Unknown / Unconfirmed'],
  ]) {
    for (const source of ['tank_automation_logs', 'device_commands', 'control_logs']) {
      const row = source === 'device_commands' ? { command_type: 'DRAIN_FOR', command_status: status }
        : { action_type: 'AUTO_DRAIN', action_status: status };
      assert.equal(getRecordedActionOutcome(row, source), expected, `${source} ${status}`);
      assert.equal(getActionStatusPresentation(row, source).label, expected);
    }
  }
});

test('each source uses its authoritative field with nullish fallback and case normalization', () => {
  const row = { action_status: ' DONE ', command_status: 'running', status: 'pending', result: 'failed' };
  assert.equal(getRecordedActionStatus(row, 'tank_automation_logs'), 'done');
  assert.equal(getRecordedActionStatus(row, 'device_commands'), 'running');
  assert.equal(getRecordedActionStatus(row), 'done');
  assert.equal(getRecordedActionStatus({ action_status: null, command_status: 'completed' }), 'completed');
  assert.equal(getRecordedActionStatus({ action_status: '', command_status: 'done' }), '');
  assert.equal(getRecordedActionStatus({ status: 'running', result: 'done' }), 'running');
  assert.equal(getRecordedActionStatus({ result: 'done' }), 'done');
  assert.equal(getRecordedActionStatus({ command_status: 'done', metadata: { action_status: 'pending' } }), 'done');
  assert.equal(getRecordedActionStatus({ status: 'done', metadata: { action_status: 'pending' } }), 'done');
  assert.equal(getRecordedActionStatus({ status: 'resolved', metadata: { action_status: 'done' } }), 'done');
  assert.equal(getRecordedActionStatus({ command_status: 'done', status: 'pending', result: 'failed' }, 'device_commands'), 'done');
  assert.equal(getRecordedActionStatus({ command_status: null, action_status: 'failed', status: 'pending' }, 'device_commands'), 'pending');
  assert.equal(getRecordedActionStatus({ action_status: null, command_status: 'done', status: 'pending' }, 'tank_automation_logs'), 'pending');
});

test('verified automation and manual DONE show green Completed without unrelated metadata or acknowledgement text', () => {
  for (const type of ['AUTO_DRAIN', 'AUTO_REFILL', 'DRAIN_FOR', 'REFILL_FOR']) {
    const automatic = type.startsWith('AUTO_');
    const source = automatic ? 'tank_automation_logs' : 'device_commands';
    const row = { ...record, ...(automatic ? { action_type: type, action_status: 'done', reason }
      : { command_type: type, command_status: 'done', result_message: reason }) };
    const before = structuredClone(row);
    assert.equal(getRecordedActionOutcome(row), 'Completed');
    const [event] = buildTankActivity({ tank, userId: tank.user_id, sources: { [source]: [row, row] } });
    assert.equal(event.outcome, 'Completed');
    assert.equal(event.outcomeTone, 'completed');
    assert.doesNotMatch(event.result, /pending|unconfirmed|not been verified|not been confirmed/i);
    assert.doesNotMatch(formatRecordedPumpAction(row, source).message, /pending|unconfirmed|not been verified|not been confirmed/i);
    if (automatic) {
      assert.equal(event.result, 'The automatic action completed and the expected water-level movement was confirmed.');
      assert.equal(event.reason, reason);
    }
    assert.deepEqual(row, before);
    assert.equal(buildTankActivity({ tank, userId: tank.user_id, sources: { [source]: [row, row] } }).length, 1);
  }
});

test('saved failure, block and recheck result text does not depend on reason parsing', () => {
  for (const [action_status, message] of [
    ['failed', 'The actuator action could not be completed.'],
    ['blocked', 'The action was intentionally blocked by a safety rule.'],
    ['rechecking', 'The pump action was executed. Fresh sensor readings are still being checked.'],
  ]) {
    const [event] = buildTankActivity({ tank, userId: tank.user_id, sources: {
      tank_automation_logs: [{ ...record, action_type: 'AUTO_DRAIN', action_status, reason }],
    } });
    assert.equal(event.result, message);
    if (action_status === 'rechecking') assert.equal(event.outcomeTone, 'rechecking');
  }
});
