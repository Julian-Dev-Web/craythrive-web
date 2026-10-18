import { test, expect, user } from './fixtures.mjs';

const date = '2026-10-11T02:00:00Z';
const row = (id, fields = {}) => ({ id, tank_id: 'tank-a', user_id: user.id, created_at: date, ...fields });
const entry = (panel, source, id) => panel.locator(`[data-activity-id="${source}:${id}"]`);
async function open(page, route = '/admin/tanks/tank-a') {
  await page.goto(route);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Tank activity history', exact: true });
  await expect(panel.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
  return panel;
}
function setup(qa) {
  qa.serverTime = date;
  qa.data.sensor_readings.forEach(reading => { reading.created_at = date; });
  // Chronology fixtures must not drift as the wall-clock test date advances.
  qa.data.ammonia_readings.forEach(reading => { reading.created_at = '2026-10-11T01:00:00Z'; });
  qa.data.device_commands = [row('request', { command_type: 'FEED_ONCE', command_status: 'pending', result_message: 'Queued for checking' }),
    row('refill', { command_type: 'REFILL_FOR', command_status: 'done', executed_at: date, result_message: 'REFILL_FOR completed for 2000 ms. Safety check passed.' }),
    row('no-ack', { command_type: 'FEED_ONCE', command_status: 'done' })];
  qa.data.alerts = [row('warning', { type: 'sensor_reading', title: 'Low pH warning', severity: 'warning', message: 'pH was below its configured range.',
    metadata: { parameter: 'ph', sensor_snapshot: { value: 6.4, thresholds: { phMin: 6.5, phMax: 8.5 } } } }),
    row('critical', { type: 'sensor_reading', title: 'Critical high temperature', severity: 'critical', message: 'Temperature was high.', created_at: '2026-10-11T03:00:00Z' }),
    row('command-alert', { command_id: 'refill', title: 'Add Water completed', type: 'actuator' })];
  qa.data.control_logs = [row('threshold', { action_type: 'threshold_updated', action_status: 'updated', notes: 'Water Level Minimum: 4 cm → 5 cm.',
    metadata: { source: 'manual', old_values: { waterLevelMin: 4 }, new_values: { waterLevelMin: 5 } } })];
  qa.data.tank_automation_logs = [row('skip', { action_type: 'AUTO_FEED', action_status: 'skipped', reason: 'pH is unsafe for feeding.' })];
}

test('chronological history combines actual events, acknowledgements and reasons without writes', async ({ page, qa }) => {
  setup(qa);
  const before = structuredClone(qa.data);
  const panel = await open(page);
  await expect(entry(panel, 'device_commands', 'request')).toContainText('Requested');
  await expect(entry(panel, 'device_commands', 'no-ack')).toContainText('Unknown / Unconfirmed');
  await expect(entry(panel, 'device_commands', 'refill').locator('.tank-activity-outcome')).toHaveText('Completed');
  await expect(entry(panel, 'tank_automation_logs', 'skip')).toContainText('Skipped');
  await expect(entry(panel, 'tank_automation_logs', 'skip')).toContainText('pH is unsafe for feeding.');
  await expect(entry(panel, 'alerts', 'warning')).toContainText('Safe Range: 6.5–8.5');
  await expect(entry(panel, 'alerts', 'warning')).toContainText('Inspection guidance');
  await expect(entry(panel, 'alerts', 'critical')).toContainText('threshold was not saved');
  await expect(entry(panel, 'alerts', 'command-alert')).toHaveCount(0);
  expect(await panel.locator('li[data-activity-id]').first().getAttribute('data-activity-id')).toBe('alerts:critical');
  expect(qa.writes).toEqual([]);
  expect(qa.data).toEqual(before);
});

test('Latest Action and history agree that a done status without acknowledgement is unconfirmed', async ({ page, qa }) => {
  setup(qa);
  qa.data.device_commands = [row('no-ack', { command_type: 'REFILL_FOR', command_status: 'done' })];
  await page.goto('/admin/tanks/tank-a');
  const summary = page.locator('.command-status-card').filter({ has: page.getByRole('button', { name: 'View Activity', exact: true }) });
  await expect(summary).toContainText('Unknown / Unconfirmed');
  await expect(summary).toContainText('Execution has not been confirmed');
  await expect(summary).not.toContainText('Completed successfully');
  await page.getByRole('button', { name: 'View Activity', exact: true }).click();
  await expect(page.locator('[data-activity-id="device_commands:no-ack"]')).toContainText('Unknown / Unconfirmed');
  expect(qa.writes).toEqual([]);
});

test('raw automation and mirrored command appear once; a handled alert is not a recovered sensor', async ({ page, qa }) => {
  setup(qa);
  qa.data.tank_automation_logs.push(row('auto', { action_type: 'AUTO_REFILL', action_status: 'done', reason: 'Automatic water-level correction pulse completed.' }));
  qa.data.device_commands.push(row('mirror', { command_type: 'REFILL_FOR', command_value: 'auto', command_status: 'done', executed_at: date,
    result_message: 'Automatic water assist: correction | Auto log id: auto' }));
  qa.data.alerts[0].status = 'resolved';
  qa.data.alerts[0].resolved_at = date;
  const panel = await open(page);
  await expect(entry(panel, 'tank_automation_logs', 'auto')).toContainText('Automatic water refill');
  await expect(entry(panel, 'device_commands', 'mirror')).toHaveCount(0);
  await expect(entry(panel, 'alerts', 'warning')).toContainText('sensor recovery was not independently recorded');
  await panel.getByRole('button', { name: 'Refresh activity' }).click();
  await expect(entry(panel, 'tank_automation_logs', 'auto')).toHaveCount(1);
  expect(qa.writes).toEqual([]);
});

test('activity filters apply Philippine calendar dates before retrieval', async ({ page, qa }) => {
  setup(qa);
  qa.data.alerts.push(row('midnight', { type: 'sensor_recovery', title: 'pH recovered', severity: 'normal', created_at: '2026-10-10T16:00:00Z' }),
    row('previous', { type: 'sensor_reading', title: 'Previous day alert', severity: 'warning', created_at: '2026-10-10T15:59:59Z' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await open(page);
  await panel.getByLabel('From date', { exact: true }).fill('2026-10-11');
  await panel.getByLabel('To date', { exact: true }).fill('2026-10-11');
  await expect(entry(panel, 'alerts', 'midnight')).toBeVisible();
  await expect(entry(panel, 'alerts', 'midnight')).toContainText('12:00 AM');
  await expect(entry(panel, 'alerts', 'previous')).toHaveCount(0);
  await panel.getByLabel('Activity type', { exact: true }).selectOption('sensor');
  await expect(panel.locator('li[data-activity-id]')).toHaveCount(3);
  expect(qa.reads.some(read => read.table === 'alerts' && read.query?.some(([key, value]) => key === 'created_at' && value === 'gte.2026-10-10T16:00:00.000Z')
    && read.query.some(([key, value]) => key === 'created_at' && value === 'lt.2026-10-11T16:00:00.000Z'))).toBe(true);
  expect(qa.writes).toEqual([]);
});

test('a stalled refresh times out, preserves verified history and supports a fresh retry', async ({ page, qa }) => {
  setup(qa);
  const panel = await open(page);
  qa.activityReadDelay = 16000;
  await panel.getByRole('button', { name: 'Refresh activity' }).click();
  await expect(panel.getByRole('alert')).toContainText('timed out or was interrupted', { timeout: 20000 });
  await expect(entry(panel, 'device_commands', 'refill')).toBeVisible();
  await expect(panel.getByRole('alert')).toContainText('Showing previously loaded activity');
  // Allow the intercepted slow response to finish before retrying.
  await page.waitForTimeout(1200);
  qa.activityReadDelay = 0;
  await panel.getByRole('button', { name: 'Retry activity' }).click();
  await expect(entry(panel, 'device_commands', 'refill')).toBeVisible();
  expect(qa.writes).toEqual([]);
});

test('a tank with no recorded events has an honest empty state', async ({ page, qa }) => {
  qa.data.ammonia_readings = [];
  const panel = await open(page);
  await expect(panel).toContainText('Missing history does not prove that no device action occurred');
  await expect(panel.locator('li[data-activity-id]')).toHaveCount(0);
  expect(qa.writes).toEqual([]);
});

test('an initial activity failure offers retry without claiming empty or previously verified history', async ({ page, qa }) => {
  setup(qa);
  qa.activityReadFailure = true;
  const panel = await open(page);
  await expect(panel.getByRole('alert')).toContainText('Activity could not be loaded');
  await expect(panel).not.toContainText('Showing previously loaded activity');
  await expect(panel).not.toContainText('No recorded activity matches these filters');
  qa.activityReadFailure = false;
  await panel.getByRole('button', { name: 'Retry activity', exact: true }).click();
  await expect(entry(panel, 'device_commands', 'refill')).toBeVisible();
  expect(qa.writes).toEqual([]);
});

test('changing current thresholds cannot rewrite saved event severity, limits or notes', async ({ page, qa }) => {
  setup(qa);
  const panel = await open(page);
  const recorded = await entry(panel, 'alerts', 'warning').textContent();
  qa.data.threshold_settings[0].thresholds = { temperatureMin: 1, temperatureMax: 80, phMin: 2, phMax: 12, waterLevelMin: 0.1, turbidityMax: 0.5, ammoniaMax: 99 };
  await panel.getByRole('button', { name: 'Refresh activity' }).click();
  await expect(entry(panel, 'alerts', 'warning')).toHaveText(recorded);
  await expect(entry(panel, 'control_logs', 'threshold')).toContainText('Water Level Minimum: 4 cm → 5 cm.');
  expect(qa.writes).toEqual([]);
});

test('unavailable automation RPC preserves mirrored history and clearly reports the pending update', async ({ page, qa }) => {
  setup(qa);
  qa.activityRPCMissing = true;
  qa.data.device_commands.push(row('mirror-only', { command_type: 'REFILL_FOR', command_status: 'done', command_value: 'auto', executed_at: date,
    result_message: 'Automatic water assist: correction | Auto log id: unavailable' }));
  const panel = await open(page);
  await expect(panel).toContainText('full automation history is unavailable');
  await expect(entry(panel, 'device_commands', 'mirror-only')).toContainText('Unknown / Unconfirmed');
  await expect(entry(panel, 'device_commands', 'refill')).toBeVisible();
  expect(qa.reads.some(read => read.table === 'tank_automation_logs')).toBe(false);
  expect(qa.writes).toEqual([]);
});

test('failed refresh preserves previous history with an error instead of showing empty success', async ({ page, qa }) => {
  setup(qa);
  const panel = await open(page);
  qa.activityReadFailure = true;
  await panel.getByRole('button', { name: 'Refresh activity' }).click();
  await expect(panel.getByRole('alert')).toContainText('Activity could not be loaded');
  await expect(entry(panel, 'device_commands', 'refill')).toBeVisible();
  await expect(panel.getByRole('alert')).toContainText('Showing previously loaded activity');
  // Let expected 403 responses finish emitting their browser console events
  // before clearing the mock failure flag and starting a fresh request.
  await page.waitForLoadState('networkidle');
  qa.activityReadFailure = false;
  await panel.getByRole('button', { name: 'Retry activity' }).click();
  await expect(entry(panel, 'device_commands', 'refill')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(qa.writes).toEqual([]);
});

test('silent refresh retrieves new activity and pauses polling while the page is hidden', async ({ page, qa }) => {
  setup(qa);
  await page.clock.install();
  const panel = await open(page);
  await page.waitForLoadState('networkidle');
  const reads = () => qa.reads.filter(read => read.table === 'get_tank_automation_history').length;
  const before = reads();
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
  await page.clock.runFor(65000);
  expect(reads()).toBe(before);
  qa.data.control_logs.push(row('new-event', { action_type: 'threshold_updated', notes: 'New saved threshold change' }));
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(entry(panel, 'control_logs', 'new-event')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
  expect(reads()).toBe(before + 1);
  expect(qa.writes).toEqual([]);
});

test('changing dates during a refresh discards the old response instead of restoring another filter scope', async ({ page, qa }) => {
  setup(qa);
  const panel = await open(page);
  await page.waitForLoadState('networkidle');
  let release;
  let started = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/rest/v1/rpc/get_tank_automation_history', async route => {
    started = true;
    await gate;
    // A scope change aborts this browser request before the test releases it.
    if (!route.request().failure()) await route.fallback();
  }, { times: 1 });
  try {
    await panel.getByRole('button', { name: 'Refresh activity', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await panel.getByLabel('From date', { exact: true }).fill('2026-10-12');
    await expect(panel.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
    await expect(panel.locator('li[data-activity-id]')).toHaveCount(0);
    release();
    await page.waitForLoadState('networkidle');
    await expect(panel.locator('li[data-activity-id]')).toHaveCount(0);
    await expect(panel).toContainText('No recorded activity matches these filters');
    expect(qa.writes).toEqual([]);
  } finally { release(); }
});

test('tank changes, narrow layouts, filtering and pagination keep events isolated and readable', async ({ page, qa }) => {
  setup(qa);
  qa.data.control_logs = Array.from({ length: 12 }, (_, i) => row(`entry-${i}`, { action_type: 'threshold_updated', notes: `Saved change ${i}` }));
  qa.data.control_logs.push(row('foreign-owner', { user_id: 'another', notes: 'Do not show' }), row('other-tank', { tank_id: 'tank-b', notes: 'Tank B only' }));
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const panel = await open(page);
    await panel.getByLabel('Activity type', { exact: true }).selectOption('thresholds');
    await expect(panel.locator('li[data-activity-id]')).toHaveCount(10);
    await panel.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(panel.locator('li[data-activity-id]')).toHaveCount(2);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(panel).not.toContainText('Do not show');
    if (width === 360) await page.screenshot({ path: '.security-tank-activity-phone.png', fullPage: true });
  }
  const other = await open(page, '/admin/tanks/tank-b');
  await expect(other).toContainText('Tank B only');
  await expect(other).not.toContainText('Saved change');
  expect(qa.writes).toEqual([]);
});

test('background activity refresh keeps the current page and mounted events visible', async ({ page, qa }) => {
  setup(qa);
  qa.data.control_logs = Array.from({ length: 12 }, (_, i) => row(`entry-${i}`, { action_type: 'threshold_updated', notes: `Saved change ${i}` }));
  await page.clock.install();
  const panel = await open(page);
  await panel.getByLabel('Activity type', { exact: true }).selectOption('thresholds');
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(panel.getByRole('navigation', { name: 'Activity pages' })).toContainText('Page 2 of 2');
  const event = panel.locator('li[data-activity-id]').first();
  await event.evaluate(element => { element.dataset.refreshProbe = 'same-event'; });
  await page.waitForLoadState('networkidle');
  let started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/rest/v1/rpc/get_tank_automation_history', async route => {
    started++;
    await gate;
    await route.fallback();
  });
  try {
    await page.clock.runFor(31000);
    await expect.poll(() => started).toBe(1);
    await expect(panel.locator('li[data-activity-id]')).toHaveCount(2);
    await expect(event).toHaveAttribute('data-refresh-probe', 'same-event');
    await expect(panel).not.toContainText('Loading verified activity');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    release();
    await expect(panel.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
    expect(started).toBe(1);
    await expect(panel.getByRole('navigation', { name: 'Activity pages' })).toContainText('Page 2 of 2');
    await expect(event).toHaveAttribute('data-refresh-probe', 'same-event');
    await expect(panel.getByLabel('Activity type', { exact: true })).toHaveValue('thresholds');
    await panel.getByRole('button', { name: 'Refresh activity', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
    await expect(panel.getByRole('navigation', { name: 'Activity pages' })).toContainText('Page 2 of 2');
    expect(qa.writes).toEqual([]);
  } finally { release(); }
});
