import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTankActivity, getRecordedActionOutcome } from '../supabase/functions/_shared/tankActivity.js';
import { waterAutomationStatus } from '../supabase/functions/_shared/waterAutomationStatus.js';
import { formatMonitoringAlert, waterAutomationAlertSeverity } from '../supabase/functions/_shared/monitoringAlertPresentation.js';

const tank = { id: 'tank-a', user_id: 'owner', name: 'Tank A' };
const row = (id, extra = {}) => ({ id, user_id: 'owner', tank_id: tank.id,
  created_at: '2026-10-19T02:00:00Z', action_type: 'AUTO_REFILL', ...extra });
const history = sources => buildTankActivity({ tank, userId: 'owner', sources });

test('automatic water statuses A–E honor the recorded contract and preserve diagnostic evidence', () => {
  for (const [action_type, action_status, reason, label] of [
    ['AUTO_REFILL', 'done', 'Expected sensor movement confirmed.', 'Completed'],
    ['AUTO_REFILL', 'rechecking', 'Before: 1.80 cm; latest: 1.51 cm', 'Rechecking'],
    ['AUTO_DRAIN', 'rechecking', 'Sensor settling', 'Rechecking'],
    ['AUTO_REFILL', 'failed', 'STOP_ALL interrupted the pump action.', 'Failed'],
    ['AUTO_DRAIN', 'blocked', 'Safety lock enabled.', 'Blocked'],
    ['AUTO_DRAIN', 'skipped', 'No correction needed.', 'Skipped'],
  ]) {
    const raw = row('event', { action_type, action_status, reason, water_status: 'LOW_WARNING', stable_reading_count: 3, duration_seconds: 2 });
    const snapshot = structuredClone(raw);
    const [event] = history({ tank_automation_logs: [raw] });
    assert.equal(event.outcome, label);
    assert.equal(event.reason, reason);
    assert.equal(event.context.find(item => item.label === 'stable reading count').value, '3');
    assert.match(event.timestampLabel, /10:00 AM/);
    assert.deepEqual(raw, snapshot);
    if (action_status === 'rechecking') {
      assert.equal(event.outcomeTone, 'rechecking');
      assert.equal(event.severity, 'no-data');
      assert.equal(event.result, 'The pump action was executed. Fresh sensor readings are still being checked.');
      assert.doesNotMatch(event.result, /reached|Failed|Unconfirmed/);
    }
  }
});

test('unknown and pending remain distinct; failed is authoritative regardless of diagnostic wording', () => {
  for (const action_status of [null, undefined, 'unknown', 'constructor', '__proto__']) {
    assert.equal(getRecordedActionOutcome(row('old', { action_status }), 'tank_automation_logs'), 'Unknown / Unconfirmed');
  }
  assert.equal(getRecordedActionOutcome(row('queued', { action_status: 'pending' }), 'tank_automation_logs'), 'Pending Verification');
  const raw = row('legacy', { action_status: 'failed', reason: 'No water movement confirmed by fresh readings.' });
  assert.equal(waterAutomationStatus(raw).label, 'Failed');
  assert.equal(raw.action_status, 'failed');
  assert.equal(waterAutomationStatus(row('sensor-check', { action_status: 'failed', reason: 'Sensor verification interrupted; effect inconclusive.' })).label, 'Failed');
  assert.equal(waterAutomationStatus(row('stop', { action_status: 'failed', reason: 'Pump action could not complete.' })).label, 'Failed');
});

test('explicit IDs deduplicate raw, command, control and alert mirrors without merging independent attempts', () => {
  const sources = {
    tank_automation_logs: [row('auto-1', { action_status: 'rechecking' }), row('auto-2', { action_status: 'rechecking' })],
    device_commands: [row('mirror', { action_type: undefined, command_type: 'REFILL_FOR', command_value: 'auto', command_status: 'done', result_message: 'Auto log id: auto-1' })],
    control_logs: [row('control', { metadata: { automation_log_id: 'auto-1' } })],
    alerts: [row('alert', { metadata: { tank_automation_log_id: 'auto-1' } }), row('command-alert', { command_id: 'mirror' }),
      row('control-alert', { metadata: { control_log_id: 'control' } })],
  };
  const snapshot = structuredClone(sources);
  assert.deepEqual(history(sources).map(event => event.id), ['tank_automation_logs:auto-1', 'tank_automation_logs:auto-2']);
  assert.deepEqual(sources, snapshot);
});

test('known rechecking overrides stale titles, stays informational and never hides a separate sensor alert', () => {
  const raw = row('alert', { type: 'control_log', title: 'Add Water failed', severity: 'critical',
    action_type: undefined, metadata: { action_type: 'AUTO_REFILL', action_status: 'rechecking' } });
  assert.equal(formatMonitoringAlert(raw).title, 'Add Water – Executed – Rechecking');
  assert.equal(waterAutomationAlertSeverity(raw), 'info');
  assert.equal(waterAutomationAlertSeverity({ ...raw, type: 'sensor_reading' }), null);
  assert.equal(raw.severity, 'critical');
});

test('command_status remains authoritative even when diagnostic text contains a different outcome', () => {
  const mirror = { command_type: 'REFILL_FOR', command_value: 'auto', command_status: 'done', result_message: 'Auto log id: absent' };
  assert.equal(getRecordedActionOutcome(mirror), 'Completed');
  mirror.command_status = 'done';
  mirror.result_message = 'Before: 1.80 cm | Auto action status: rechecking | Auto log id: absent';
  assert.equal(getRecordedActionOutcome(mirror), 'Completed');
});

test('repeated fallback mirrors share one card and notifications cannot override the command evidence', () => {
  const mirror = row('mirror', { action_type: undefined, command_type: 'REFILL_FOR', command_value: 'auto', command_status: 'done',
    result_message: 'Auto action status: rechecking | Auto log id: unavailable' });
  const events = history({ device_commands: [mirror, { ...mirror, id: 'mirror-again' }],
    alerts: [row('notification', { metadata: { auto_log_id: 'unavailable', action_type: 'AUTO_REFILL', action_status: 'failed' }, reason: 'STOP_ALL interruption' })] });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'Completed');
  assert.doesNotMatch(events[0].reason, /Auto log id/);
});
