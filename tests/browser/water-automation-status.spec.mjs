import { test, expect, user } from './fixtures.mjs';

const date = '2026-10-19T02:00:00Z';
const row = (id, values = {}) => ({ id, user_id: user.id, tank_id: 'tank-a', created_at: date, ...values });
const entry = (page, id) => page.locator(`[data-activity-id="tank_automation_logs:${id}"]`);

test('verified AUTO_DRAIN/AUTO_REFILL and manual DONE are green Completed without acknowledgement fields', async ({ page, qa }) => {
  const reason = 'controlled exchange drain verified: before=3.21 cm, after=2.10 cm, delta=-1.11 cm. Expected water decrease confirmed.';
  const drain = row('verified-drain', { action_type: 'AUTO_DRAIN', action_status: 'done', command_status: 'pending', reason });
  qa.data.tank_automation_logs = [drain, drain, row('verified-refill', { action_type: 'AUTO_REFILL', action_status: 'done', reason })];
  qa.data.device_commands = ['DRAIN_FOR', 'REFILL_FOR'].map(command_type => row(command_type, { command_type,
    action_type: command_type === 'DRAIN_FOR' ? 'AUTO_DRAIN' : 'AUTO_REFILL', command_status: 'done', action_status: 'pending' }));
  qa.data.control_logs = [];
  qa.data.alerts = [];
  qa.data.ammonia_readings = [];
  const before = structuredClone(qa.data);
  await page.goto('/admin/tanks/tank-a');
  const latest = page.locator('.command-status-card').filter({ has: page.getByRole('button', { name: 'View Activity', exact: true }) });
  await expect(latest).toContainText('Completed');
  await expect(latest).not.toContainText('Execution has not been confirmed');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const cards = page.locator('li[data-activity-id]');
  await expect(cards).toHaveCount(4);
  await expect(page.locator('.tank-activity-outcome.outcome-completed')).toHaveCount(4);
  for (const card of await cards.all()) {
    await expect(card.locator('.tank-activity-outcome')).toHaveText('Completed');
    await expect(card).not.toContainText('Pending Verification');
    await expect(card).not.toContainText('Execution has not been confirmed');
  }
  await expect(entry(page, 'verified-drain')).toContainText(reason);
  await expect(entry(page, 'verified-drain')).toContainText('The actuator automatically drained water.');
  await expect(entry(page, 'verified-drain')).toHaveCount(1);
  expect(qa.writes).toEqual([]);
  expect(qa.data).toEqual(before);
});

for (const width of [1440, 390]) {
  test(`automatic water outcomes, context and explicit-ID deduplication at ${width}px`, async ({ page, qa }) => {
    await page.setViewportSize({ width, height: 900 });
    qa.data.device_commands = [row('mirror', { command_type: 'REFILL_FOR', command_value: 'auto', command_status: 'done',
      result_message: 'Automatic water assist: no movement | Auto log id: refill-check' })];
    qa.data.control_logs = [row('control-mirror', { action_type: 'AUTO_REFILL', action_status: 'failed', metadata: { auto_log_id: 'refill-check' } })];
    qa.data.alerts = [row('alert-mirror', { type: 'control_log', title: 'Add Water failed', severity: 'critical',
      metadata: { action_type: 'AUTO_REFILL', action_status: 'rechecking', tank_automation_log_id: 'refill-check' } })];
    qa.data.tank_automation_logs = [
      row('refill-done', { action_type: 'AUTO_REFILL', action_status: 'done', reason: 'Expected water movement confirmed.' }),
      row('refill-check', { action_type: 'AUTO_REFILL', action_status: 'rechecking', reason: 'Water depth before: 1.80 cm. Latest reading: 1.51 cm.',
        water_status: 'LOW_WARNING', ph_status: 'SAFE_IDEAL', stable_reading_count: 3, duration_seconds: 2 }),
      row('drain-check', { action_type: 'AUTO_DRAIN', action_status: 'rechecking', reason: 'Ultrasonic readings settling.' }),
      row('refill-fail', { action_type: 'AUTO_REFILL', action_status: 'failed', reason: 'STOP_ALL interrupted the pump action.' }),
      row('drain-block', { action_type: 'AUTO_DRAIN', action_status: 'blocked', reason: 'Safety lock enabled.' }),
      row('legacy-fail', { action_type: 'AUTO_REFILL', action_status: 'failed', reason: 'Sensor movement could not be confirmed.' }),
    ];
    const before = structuredClone(qa.data);
    await page.goto('/admin/tanks/tank-a');
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(entry(page, 'refill-check').locator('.tank-activity-outcome')).toHaveText('Rechecking');
    await expect(entry(page, 'drain-check').locator('.tank-activity-outcome')).toHaveText('Rechecking');
    await expect(entry(page, 'refill-done').locator('.tank-activity-outcome')).toHaveText('Completed');
    await expect(entry(page, 'refill-fail').locator('.tank-activity-outcome')).toHaveText('Failed');
    await expect(entry(page, 'drain-block').locator('.tank-activity-outcome')).toHaveText('Blocked');
    await expect(entry(page, 'legacy-fail').locator('.tank-activity-outcome')).toHaveText('Failed');
    await expect(page.locator('li[data-activity-id]')).toHaveCount(7); // six automation + this tank's manual ammonia record
    await expect(entry(page, 'refill-check')).toContainText('1.80 cm. Latest reading: 1.51 cm.');
    await expect(entry(page, 'refill-check')).toContainText('Fresh sensor readings are still being checked');
    await expect(entry(page, 'refill-check')).toContainText('LOW_WARNING');
    await expect(entry(page, 'refill-check')).toContainText('stable reading count: 3');
    await expect(entry(page, 'refill-check')).toContainText('Recorded duration: 2 seconds');
    await expect(entry(page, 'refill-check')).toContainText('10:00 AM');
    const recheckingColor = await entry(page, 'refill-check').locator('.tank-activity-outcome').evaluate(node => getComputedStyle(node).color);
    const failedColor = await entry(page, 'refill-fail').locator('.tank-activity-outcome').evaluate(node => getComputedStyle(node).color);
    expect(recheckingColor).not.toBe(failedColor);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
    await expect(entry(page, 'refill-check')).toHaveCount(1);
    expect(qa.writes).toEqual([]);
    expect(qa.data).toEqual(before);
  });
}

test('rechecking notifications remain informational across Alerts, Dashboard and Tank Details', async ({ page, qa }) => {
  qa.data.alerts = [row('recheck', { type: 'control_log', title: 'Add Water failed', message: 'Old wording', severity: 'critical', status: 'active',
    metadata: { action_type: 'AUTO_REFILL', action_status: 'rechecking', notes: 'Before: 1.80 cm; latest: 1.51 cm' } })];
  await page.goto('/admin/alerts');
  const card = page.locator('.cray-alert-card').filter({ hasText: 'Executed – Rechecking' });
  await expect(card).toHaveCount(1);
  await expect(card).not.toContainText('Critical');
  await expect(card).toContainText('Fresh sensor readings');
  await page.goto('/admin');
  await expect(page.locator('.cray-priority-alert')).toHaveCount(0);
  await page.goto('/admin/tanks/tank-a');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  const tankAlert = page.locator('.modern-tank-detail-list-row').filter({ hasText: 'Executed – Rechecking' });
  await expect(tankAlert).toHaveCount(1);
  await expect(tankAlert).not.toContainText('Critical');
  expect(qa.writes).toEqual([]);
});
