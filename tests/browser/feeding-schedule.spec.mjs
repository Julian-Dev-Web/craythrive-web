import { test, expect, user } from './fixtures.mjs';

const instant = '2026-10-18T10:00:00Z';
const panelFor = page => page.getByRole('region', { name: 'Automatic feeding schedule', exact: true });
const writes = qa => qa.writes.filter(write => write.table === 'tank_automation_settings');
function setup(qa) {
  qa.serverTime = instant;
  qa.data.iot_devices = [{ id: 'actuator-a', tank_id: 'tank-a', user_id: user.id, device_uid: 'actuator-a', device_type: 'actuator_hub', is_claimed: true, last_seen: instant }];
  qa.data.tank_automation_settings = [{ id: 'settings-a', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a',
    auto_feeding_enabled: true, auto_feed_hour: 20, auto_feed_minute: 30, auto_feed_cycles: 3,
    auto_water_enabled: false, auto_water_level_enabled: true, auto_water_quality_enabled: false,
    auto_ph_enabled: true, require_stable_readings: true, stable_reading_count: 5, drain_seconds: 2, refill_seconds: 4 }];
}
async function open(page, route = '/admin/tanks/tank-a') {
  await page.goto(route);
  if (route.includes('/tanks/')) await page.getByRole('button', { name: 'Controls', exact: true }).click();
  const panel = panelFor(page);
  await expect(panel.getByRole('button', { name: 'Save Feeding Schedule', exact: true })).toBeEnabled();
  return panel;
}

test('saved settings load on Tank Details and Settings without writes or feeding commands', async ({ page, qa }) => {
  setup(qa);
  for (const route of ['/admin/tanks/tank-a', '/admin/settings?tank=tank-a']) {
    const panel = await open(page, route);
    await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('20:30');
    await expect(panel.getByRole('radio', { name: /3 Cycles/ })).toBeChecked();
    await expect(panel).toContainText('8:30 PM');
    await expect(panel).toContainText('Philippine Time (UTC+8)');
  }
  expect(qa.writes).toEqual([]);
});

test('a missing row shows ON / 19:00 / 2 without silently creating defaults', async ({ page, qa }) => {
  setup(qa); qa.data.tank_automation_settings = [];
  const panel = await open(page);
  await expect(panel.getByRole('switch')).toBeChecked();
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('19:00');
  await expect(panel.getByRole('radio', { name: /2 Cycles/ })).toBeChecked();
  await expect(panel).toContainText('Nothing is saved until you click');
  expect(writes(qa)).toEqual([]);
});

test('save is per tank, preserves all water settings, persists after reload and never sends FEED_ONCE', async ({ page, qa }) => {
  setup(qa);
  const original = structuredClone(qa.data.tank_automation_settings[0]);
  qa.data.tank_automation_settings.push({ ...original, id: 'settings-b', tank_id: 'tank-b', auto_feed_hour: 21 });
  const other = structuredClone(qa.data.tank_automation_settings[1]);
  let panel = await open(page);
  await panel.getByLabel('Feeding Time', { exact: true }).fill('21:15');
  await panel.getByRole('radio', { name: /1 Cycle/ }).check();
  await panel.getByRole('button', { name: 'Save Feeding Schedule', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Automatic feeding schedule updated.');
  expect(writes(qa)).toHaveLength(1);
  expect(writes(qa)[0].body).toEqual({ p_tank_id: 'tank-a', p_enabled: true, p_hour: 21, p_minute: 15, p_cycles: 1 });
  expect(qa.data.tank_automation_settings[0]).toEqual({ ...original, auto_feed_hour: 21, auto_feed_minute: 15, auto_feed_cycles: 1 });
  expect(qa.data.tank_automation_settings[1]).toEqual(other);
  await page.reload(); await page.getByRole('button', { name: 'Controls', exact: true }).click(); panel = panelFor(page);
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('21:15');
  expect(qa.writes.every(write => write.table === 'tank_automation_settings')).toBe(true);
});

test('switching OFF preserves configured time and cycles across save/reload', async ({ page, qa }) => {
  setup(qa);
  let panel = await open(page);
  await panel.getByRole('switch').uncheck();
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toBeDisabled();
  await expect(panel.getByRole('radio', { name: /3 Cycles/ })).toBeDisabled();
  await panel.getByRole('button', { name: 'Save Feeding Schedule', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('updated');
  await page.reload(); await page.getByRole('button', { name: 'Controls', exact: true }).click(); panel = panelFor(page);
  await expect(panel).toContainText('Automatic feeding disabled');
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('20:30');
  await panel.getByRole('switch').check();
  await expect(panel.getByRole('radio', { name: /3 Cycles/ })).toBeChecked();
});

test('Settings tank switching uses each tank own values and a focus refresh keeps unsaved edits', async ({ page, qa }) => {
  setup(qa);
  qa.data.tank_automation_settings.push({ ...qa.data.tank_automation_settings[0], id: 'settings-b', tank_id: 'tank-b', auto_feed_hour: 6, auto_feed_minute: 45, auto_feed_cycles: 1 });
  const panel = await open(page, '/admin/settings?tank=tank-a');
  await page.getByLabel('Tank', { exact: true }).selectOption('tank-b');
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('06:45');
  await panel.getByLabel('Feeding Time', { exact: true }).fill('07:15');
  qa.data.tank_automation_settings[1].auto_feed_hour = 8;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.locator('.automatic-feeding-summary')).toContainText('8:45 AM');
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('07:15');
  await page.getByLabel('Tank', { exact: true }).selectOption('tank-a');
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('20:30');
  expect(writes(qa)).toHaveLength(0);
});

test('cleared time is rejected, save failures keep the draft and missing migration never claims success', async ({ page, qa }) => {
  setup(qa); const panel = await open(page);
  await panel.getByLabel('Feeding Time', { exact: true }).fill('');
  await expect(panel.getByRole('button', { name: 'Save Feeding Schedule', exact: true })).toBeDisabled();
  await panel.getByLabel('Feeding Time', { exact: true }).fill('23:58');
  qa.feedingSaveFailure = true;
  await panel.getByRole('button', { name: 'Save Feeding Schedule', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('could not be verified');
  await expect(panel.getByLabel('Feeding Time', { exact: true })).toHaveValue('23:58');
  expect(writes(qa)).toHaveLength(0);
  qa.feedingRPCMissing = true;
  await panel.getByRole('button', { name: 'Reload feeding schedule', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('database migration');
  await expect(panel).not.toContainText('Automatic feeding schedule updated.');
});

test('save double clicks are coalesced and do not generate notification or activity spam', async ({ page, qa }) => {
  setup(qa); const panel = await open(page);
  qa.feedingSaveDelay = 700;
  await panel.getByRole('button', { name: 'Save Feeding Schedule', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(panel.getByRole('status')).toContainText('updated');
  expect(writes(qa)).toHaveLength(1);
  expect(qa.data.alerts).toEqual([]); expect(qa.data.control_logs).toEqual([]); expect(qa.data.device_commands).toEqual([]);
});

for (const timezoneId of ['America/New_York', 'Asia/Tokyo', 'Europe/London']) test.describe(timezoneId, () => {
  test.use({ timezoneId });
  test('19:00 displays 7:00 PM Philippine Time in any browser timezone', async ({ page, qa }) => {
    setup(qa); qa.data.tank_automation_settings[0].auto_feed_hour = 19; qa.data.tank_automation_settings[0].auto_feed_minute = 0;
    const panel = await open(page);
    await expect(panel.locator('.automatic-feeding-summary')).toContainText('7:00 PM');
    await expect(panel).toContainText('Oct 18, 2026');
    await expect(panel).toContainText('Philippine Time (UTC+8)');
    expect(writes(qa)).toHaveLength(0);
  });
});

test('no browser timer executes feeding when its saved schedule arrives', async ({ page, qa }) => {
  setup(qa); await page.clock.install();
  qa.data.tank_automation_settings[0].auto_feed_hour = 18; qa.data.tank_automation_settings[0].auto_feed_minute = 1;
  await open(page); await page.clock.runFor(180000);
  expect(qa.writes).toEqual([]); expect(qa.data.device_commands).toEqual([]);
});

test('compact schedule remains usable at phone, tablet and desktop widths', async ({ page, qa }) => {
  setup(qa);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/admin/tanks/tank-a', '/admin/settings?tank=tank-a']) {
      const panel = await open(page, route);
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(panel.getByRole('button', { name: 'Save Feeding Schedule', exact: true })).toBeVisible();
    }
  }
  expect(qa.writes).toEqual([]);
});
