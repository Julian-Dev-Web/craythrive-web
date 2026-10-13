import { test, expect } from './fixtures.mjs';
import fs from 'node:fs/promises';

const pages = [
  ['/admin', '.farmer-water-item'], ['/admin/tanks', '.modern-tank-sensor-card'],
  ['/admin/tanks/tank-a', '.modern-tank-detail-metric'], ['/admin/readings', '.modern-reading-metric'],
  ['/admin/reports', '.cray-report-metric-grid > div'],
];
function setup(qa, overrides) {
  qa.data.tanks = [qa.data.tanks[0]];
  qa.data.ammonia_readings = [];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], ph_value: 7.2, water_depth_cm: 4.02, ...overrides }];
}

for (const metadataOnly of [false, true]) {
  test(`carried water is visibly stale on all pages (${metadataOnly ? 'metadata' : 'status'} detection)`, async ({ page, qa }) => {
    setup(qa, { water_status: metadataOnly ? 'SAFE_IDEAL' : 'SENSOR_STALE', raw_payload: {
      water_value_source: 'last_good', water_measurement_fresh: false, water_last_good_age_ms: 5000,
      sensor_health: { water_level: { health: 'WARNING' } }, warning_flags: ['WATER_LEVEL_SENSOR_STALE'],
    } });
    for (const [route, selector] of pages) {
      await page.goto(route);
      const metric = page.locator(selector).filter({ hasText: 'Water Level' });
      await expect(metric).toContainText('Latest available: 4.02 cm');
      await expect(metric.locator('.safety-status')).toHaveText('Stale');
      await expect(metric.locator('.safety-status')).toHaveClass(/\bno-data\b/);
      await expect(metric).not.toContainText('Critical');
      if (route === '/admin/tanks/tank-a') {
        await expect(page.locator('.modern-tank-safety-banner')).toContainText('No Data');
      }
    }
    expect(qa.writes).toEqual([]);
  });
}

test('confirmed failure shows Sensor Error and refresh restores the real water status', async ({ page, qa }) => {
  setup(qa, { water_status: 'SENSOR_ERROR', water_depth_cm: null, water_level: null,
    raw_payload: { water_value_source: 'unavailable', water_measurement_fresh: false,
      sensor_health: { water_level: { health: 'ERROR' } }, warning_flags: ['WATER_LEVEL_SENSOR_ERROR'] } });
  for (const [route, selector] of pages) {
    await page.goto(route);
    const metric = page.locator(selector).filter({ hasText: 'Water Level' });
    await expect(metric.locator('.safety-status')).toHaveText('Sensor Error');
    await expect(metric).not.toContainText('0.00 cm');
    await expect(metric).not.toContainText('Normal');
  }
  Object.assign(qa.data.sensor_readings[0], { water_status: 'SAFE_IDEAL', water_depth_cm: 4.02,
    raw_payload: { water_value_source: 'fresh', water_measurement_fresh: true, warning_flags: [], sensor_health: { water_level: { health: 'OK' } } } });
  for (const [route, selector] of pages) {
    await page.goto(route);
    const metric = page.locator(selector).filter({ hasText: 'Water Level' });
    await expect(metric).toContainText('4.02 cm');
    // Fresh recovery is still below this tank's active 4.5 cm minimum.
    await expect(metric.locator('.safety-status')).toHaveText('Warning');
    await expect(metric).not.toContainText('Latest available');
    await expect(metric).not.toContainText('Waiting');
  }
  expect(qa.writes).toEqual([]);
});

test('startup waits without fabricating depth; CSV and print identify carried measurements', async ({ page, qa }) => {
  setup(qa, { water_status: 'NO_READING', water_depth_cm: null });
  await page.goto('/admin/readings');
  const metric = page.locator('.modern-reading-metric').filter({ hasText: 'Water Level' });
  await expect(metric.locator('.safety-status')).toHaveText('Waiting');
  await expect(metric).not.toContainText('0.00 cm');
  await expect(metric).not.toContainText('Sensor Error');
  setup(qa, { water_status: 'SENSOR_STALE', raw_payload: { water_value_source: 'last_good', water_measurement_fresh: false, water_last_good_age_ms: 10000 } });
  await page.goto('/admin/reports');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await fs.readFile(await (await pending).path(), 'utf8');
  for (const value of ['Water Value Source', 'Water Measurement Fresh', 'Water Last Good Age (ms)', 'Latest available: 4.02 cm', 'last_good', 'false', '10000']) expect(csv).toContain(value);
  const popupPending = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print Report', exact: true }).click();
  const popup = await popupPending;
  await expect(popup.locator('body')).toContainText('Latest available: 4.02 cm');
  expect(qa.writes).toEqual([]);
});

for (const state of ['SENSOR_STALE', 'SENSOR_ERROR']) {
  test(`mobile-width water health cards fit without horizontal overflow (${state})`, async ({ page, qa }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    setup(qa, { water_status: state, water_depth_cm: state === 'SENSOR_ERROR' ? null : 4.02,
      raw_payload: { water_measurement_fresh: false, water_value_source: state === 'SENSOR_STALE' ? 'last_good' : 'unavailable' } });
    for (const [route, selector] of pages) {
      await page.goto(route);
      const metric = page.locator(selector).filter({ hasText: 'Water Level' });
      await expect(metric.locator('.safety-status')).toHaveText(state === 'SENSOR_STALE' ? 'Stale' : 'Sensor Error');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    expect(qa.writes).toEqual([]);
  });
}
