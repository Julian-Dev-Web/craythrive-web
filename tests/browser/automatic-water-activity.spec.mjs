import { test, expect, user } from './fixtures.mjs';

const timestamp = '2026-10-19T02:00:00Z';
const reason = 'Relay pulse executed. Water depth before=2.96 cm, after=3.70 cm, delta=0.74 cm.';
const row = (id, patch = {}) => ({ id, user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a',
  action_type: 'AUTO_REFILL', action_status: 'done', reason, duration_seconds: 5, stable_reading_count: 3,
  water_status: 'LOW_WARNING', ph_status: 'SAFE_IDEAL', created_at: timestamp, ...patch });
const entry = (page, id, source = 'tank_automation_logs') => page.locator(`[data-activity-id="${source}:${id}"]`);
async function open(page) {
  await page.goto('/admin/tanks/tank-a'); await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
}
test('existing automation pulses appear without another pump run when the history RPC is not installed', async ({ page, qa }) => {
  qa.serverTime = timestamp; qa.activityRPCMissing = true; qa.data.ammonia_readings = [];
  qa.data.tank_automation_logs = [row('pulse-1'), row('pulse-2', { user_id: null }),
    row('drain-1', { action_type: 'AUTO_DRAIN' }), row('drain-2', { action_type: 'AUTO_DRAIN' }),
    row('foreign', { user_id: 'another-owner' }), row('other-tank', { tank_id: 'tank-b' })];
  // Same database ID in different tables is a separate event without an explicit link.
  qa.data.device_commands = [{ id: 'pulse-1', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a',
    command_type: 'REFILL_FOR', command_status: 'done', created_at: timestamp }];
  const before = structuredClone(qa.data);
  await open(page);
  for (const id of ['pulse-1', 'pulse-2', 'drain-1', 'drain-2']) {
    await expect(entry(page, id)).toHaveCount(1);
    await expect(entry(page, id)).toContainText(id.startsWith('drain') ? 'Automatic Water Drain' : 'Automatic Water Refill');
    await expect(entry(page, id).locator('.tank-activity-outcome')).toHaveText('Completed');
    await expect(entry(page, id)).toContainText(reason);
    await expect(entry(page, id)).toContainText('Recorded duration: 5 seconds');
    await expect(entry(page, id)).toContainText('10:00 AM');
  }
  await expect(entry(page, 'pulse-1', 'device_commands')).toHaveCount(1);
  await expect(entry(page, 'foreign')).toHaveCount(0); await expect(entry(page, 'other-tank')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.locator('[data-activity-id]')).toHaveCount(5);
  expect(qa.reads.some(read => read.table === 'tank_automation_logs')).toBe(true);
  expect(qa.writes).toEqual([]); expect(qa.data).toEqual(before);
});
test('Activity refresh fetches both sources and preserves unrelated Tank Details UI', async ({ page, qa }) => {
  qa.serverTime = timestamp; qa.data.ammonia_readings = [];
  qa.data.tank_automation_logs = [row('old')];
  await open(page); await page.waitForLoadState('networkidle');
  const priorTankReads = qa.reads.filter(read => ['tanks', 'sensor_readings'].includes(read.table)).length;
  qa.data.tank_automation_logs.push(row('new', { action_type: 'AUTO_DRAIN', action_status: 'blocked', reason: 'Drain blocked by the water safety rule.' }));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(entry(page, 'new')).toContainText('Blocked'); await expect(entry(page, 'new')).toContainText('Drain blocked by the water safety rule.');
  expect(qa.reads.filter(read => read.table === 'get_tank_automation_history').length).toBeGreaterThanOrEqual(2);
  expect(qa.reads.filter(read => read.table === 'device_commands').length).toBeGreaterThanOrEqual(2);
  // The loader re-verifies ownership; it must not refetch sensor data or remount the page.
  expect(qa.reads.filter(read => read.table === 'sensor_readings').length).toBeGreaterThan(0);
  expect(qa.reads.filter(read => ['tanks', 'sensor_readings'].includes(read.table)).length).toBe(priorTankReads + 1);
  await expect(page.getByRole('region', { name: 'Tank activity history', exact: true })).toBeVisible();
  expect(qa.writes).toEqual([]);
});
test('persistent automatic alert titles survive Alerts and bell formatting; reopening the bell loads new saved notifications', async ({ page, qa }) => {
  const alert = (id, type) => ({ id, user_id: user.id, tank_id: 'tank-a', source: 'tank_automation_logs', type: 'control_log',
    title: `Automatic Water ${type} Completed`, message: `Tank A automatically ${type === 'Refill' ? 'added' : 'drained'} water to correct the water level.`,
    status: 'active', severity: 'normal', created_at: timestamp, metadata: { water_activity_version: 1, tank_automation_log_id: id,
      action_type: type === 'Refill' ? 'AUTO_REFILL' : 'AUTO_DRAIN', action_status: 'done' } });
  qa.data.alerts = [alert('refill-alert', 'Refill')];
  await open(page);
  await expect(entry(page, 'refill-alert', 'alerts').locator('.tank-activity-outcome')).toHaveText('Completed');
  await expect(entry(page, 'refill-alert', 'alerts')).toContainText('Automatic Water Refill');
  await page.goto('/admin/alerts'); await expect(page.locator('.cray-alert-card')).toContainText('Automatic Water Refill Completed');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.locator('.modern-notification-panel')).toContainText('Automatic Water Refill Completed');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  qa.data.alerts.unshift(alert('drain-alert', 'Drain'));
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.locator('.modern-notification-panel')).toContainText('Automatic Water Drain Completed');
  expect(qa.writes).toEqual([]);
});
