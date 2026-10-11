import { test, expect, user } from './fixtures.mjs';

const metrics = '.farmer-water-item,.modern-tank-sensor-card,.modern-tank-detail-metric,.modern-reading-metric,.cray-report-metric-grid > div';
const routes = ['/admin', '/admin/tanks', '/admin/tanks/tank-a', '/admin/readings', '/admin/reports'];
const configured = { temperatureMin: 22.5, temperatureMax: 29, phMin: 6.8, phMax: 8.1,
  turbidityMax: 2.7, waterLevelMin: 3.7, ammoniaMax: 0.42 };
function override(qa, tankId, thresholds) {
  qa.data.tank_threshold_settings.push({ user_id: user.id, tank_id: tankId,
    thresholds: { ...qa.data.threshold_settings[0].thresholds, ...thresholds } });
}
function oneTank(qa) {
  qa.data.tanks = [qa.data.tanks[0]];
  qa.data.sensor_readings = [qa.data.sensor_readings[0]];
  qa.data.ammonia_readings = [{ ...qa.data.ammonia_readings[0], created_at: '2025-01-02T09:00:00Z' }];
  override(qa, 'tank-a', configured);
}
async function open(page, route) {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}
async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
const waterCard = page => page.locator(metrics).filter({ hasText: /^(?!.*Minimum).*Water Level/s });

test('all five sensor cards show the evaluator limits on every monitoring page', async ({ page, qa }) => {
  oneTank(qa);
  const raw = structuredClone(qa.data.sensor_readings);
  for (const route of routes) {
    await open(page, route);
    const ranges = page.locator('.sensor-safe-range');
    await expect(ranges).toHaveCount(5);
    for (const text of ['Safe Range: 22.5–29 °C', 'Safe Range: 6.8–8.1',
      'Safe Limit: ≥ 2.7 V', 'Safe Limit: ≥ 3.7 cm', 'Safe Limit: ≤ 0.42 mg/L']) {
      await expect(ranges.filter({ hasText: text })).toBeVisible();
    }
    await expect(page.locator(metrics).filter({ hasText: 'Water Clarity' })).toContainText('2.80 V');
    const ammonia = page.locator(metrics).filter({ hasText: 'Latest available ammonia scan' });
    await expect(ammonia).toContainText('2025');
    await expect(ammonia).not.toContainText('2026');
  }
  expect(qa.data.sensor_readings).toEqual(raw);
  expect(qa.writes).toEqual([]);
});

test('tank list and details keep distinct thresholds, including a tank with no readings', async ({ page, qa }) => {
  override(qa, 'tank-a', { waterLevelMin: 2 });
  override(qa, 'tank-b', { waterLevelMin: 3 });
  override(qa, 'tank-c', { waterLevelMin: 6.75, ammoniaMax: 0.5 });
  await open(page, '/admin/tanks');
  for (const [tank, limit] of [['Tank A', 2], ['Tank B', 3], ['Unpaired Tank', 6.75]]) {
    const card = page.locator('.modern-tank-card').filter({ has: page.getByRole('heading', { name: new RegExp(tank) }) });
    await expect(card).toContainText(`Safe Limit: ≥ ${limit} cm`);
    await expect(card.locator('.sensor-safe-range')).toHaveCount(5);
  }
  await open(page, '/admin/tanks/tank-b');
  await expect(waterCard(page)).toContainText('Safe Limit: ≥ 3 cm');
  await open(page, '/admin/tanks/tank-c');
  await expect(waterCard(page)).toContainText('Safe Limit: ≥ 6.75 cm');
  await expect(page.locator('.sensor-reading-empty')).toHaveCount(5);
  await expect(waterCard(page)).toContainText('No reading');
  await expect(waterCard(page).locator('.safety-status')).toHaveText('No Data');
  const ammonia = page.locator(metrics).filter({ hasText: 'Latest available ammonia scan' });
  await expect(ammonia).toContainText('No recent ammonia reading');
  await expect(ammonia).toContainText('Safe Limit: ≤ 0.5 mg/L');
  await expect(ammonia.locator('.safety-status')).toHaveText('No Scan');
  expect(qa.writes).toEqual([]);
});

test('empty selected tank summaries retain its override rather than another tank or legacy limits', async ({ page, qa }) => {
  override(qa, 'tank-c', { waterLevelMin: 6.75 });
  const name = qa.data.tanks[2].name;
  for (const [route, label] of [['/admin/readings', 'Filter readings by tank'],
    ['/admin/reports', 'Choose which tank to include in the report']]) {
    await open(page, route);
    await choose(page, label, name);
    await expect(waterCard(page)).toContainText('Safe Limit: ≥ 6.75 cm');
    await expect(waterCard(page)).toContainText('No reading');
    await expect(waterCard(page).locator('.safety-status')).toHaveText('No Data');
  }
});

test('Web Apply refreshes range labels across tabs without changing another tank or uploading readings', async ({ page, context, qa }) => {
  override(qa, 'tank-a', { waterLevelMin: 2 });
  override(qa, 'tank-b', { waterLevelMin: 3 });
  const raw = structuredClone(qa.data.sensor_readings);
  await open(page, '/admin/tanks/tank-a');
  await expect(waterCard(page)).toContainText('Safe Limit: ≥ 2 cm');
  const settings = await context.newPage();
  await settings.goto('/admin/settings');
  await settings.getByLabel('Tank', { exact: true }).selectOption('tank-a');
  await settings.getByLabel('Minimum Water Level value').fill('2.8');
  await settings.getByRole('button', { name: 'Apply to This Tank', exact: true }).first().click();
  await expect(settings.getByText('Threshold settings updated for Tank A.', { exact: true })).toBeVisible();
  await expect(waterCard(page)).toContainText('Safe Limit: ≥ 2.8 cm');
  await page.reload();
  await expect(waterCard(page)).toContainText('Safe Limit: ≥ 2.8 cm');
  await open(page, '/admin/tanks/tank-b');
  await expect(waterCard(page)).toContainText('Safe Limit: ≥ 3 cm');
  expect(qa.data.sensor_readings).toEqual(raw);
  expect(qa.writes.filter(write => ['device_commands', 'sensor_readings'].includes(write.table))).toEqual([]);
  await settings.close();
});

test('external account changes refresh inheriting tanks while configured overrides stay isolated', async ({ page, qa }) => {
  override(qa, 'tank-a', { waterLevelMin: 2 });
  await open(page, '/admin/tanks');
  const a = page.locator('.modern-tank-card').filter({ has: page.getByRole('heading', { name: 'Tank A', exact: true }) });
  const b = page.locator('.modern-tank-card').filter({ has: page.getByRole('heading', { name: 'Tank B', exact: true }) });
  await expect(b).toContainText('Safe Limit: ≥ 4.5 cm');
  qa.data.threshold_settings[0].thresholds.waterLevelMin = 4.8;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(b).toContainText('Safe Limit: ≥ 4.8 cm');
  await expect(a).toContainText('Safe Limit: ≥ 2 cm');
  // Another client that writes the canonical selected-tank row uses the same path.
  qa.data.tank_threshold_settings[0].thresholds.waterLevelMin = 2.6;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(a).toContainText('Safe Limit: ≥ 2.6 cm');
  await expect(b).toContainText('Safe Limit: ≥ 4.8 cm');
  expect(qa.writes).toEqual([]);
});

test('range labels fit phone layouts in light and dark themes', async ({ page, qa }) => {
  oneTank(qa);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await page.addInitScript(value => localStorage.setItem('craythrive-theme', value), theme);
    for (const route of routes) {
      await open(page, route);
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      await expect(page.locator('.sensor-safe-range')).toHaveCount(5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const range of await page.locator('.sensor-safe-range').all()) {
        expect(await range.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
    }
  }
});

test('missing readings and configured limits remain readable on a narrow phone', async ({ page, qa }) => {
  override(qa, 'tank-c', { waterLevelMin: 6.75, ammoniaMax: 0.5 });
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, '/admin/tanks/tank-c');
  await expect(page.locator('.sensor-reading-empty')).toHaveCount(5);
  await expect(page.locator('.sensor-reading-empty').filter({ hasText: 'No recent ammonia reading' })).toBeVisible();
  for (const text of await page.locator('.sensor-safe-range,.sensor-reading-empty').all()) {
    expect(await text.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.modern-tank-detail-metric-grid').screenshot({ path: '.security-safe-range-empty-phone.png' });
  expect(qa.writes).toEqual([]);
});
