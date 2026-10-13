import { test, expect, user } from './fixtures.mjs';
import fs from 'node:fs/promises';

const routes = [['/admin', '.farmer-water-item'], ['/admin/tanks', '.modern-tank-sensor-card'],
  ['/admin/tanks/tank-a', '.modern-tank-detail-metric'], ['/admin/readings', '.modern-reading-metric'],
  ['/admin/reports', '.cray-report-metric-grid > div']];
function setup(qa) {
  qa.serverTime = '2026-10-13T02:00:01Z';
  qa.data.tanks = [qa.data.tanks[0]];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], water_depth_cm: 3.05, water_level: 99, water_distance_cm: 0.1,
    ph_value: 7.2, water_status: 'SAFE_IDEAL', created_at: '2026-10-13T02:00:00Z' }];
  qa.data.ammonia_readings = [];
  qa.data.threshold_settings[0].thresholds.waterLevelMin = 3.04;
  qa.data.alerts = [{ id: 'depth-alert', user_id: user.id, tank_id: 'tank-a', title: 'Low water level', type: 'sensor_reading',
    severity: 'warning', status: 'active', created_at: '2026-10-13T01:00:00Z', message: 'Water level 3.0 cm is below the minimum of 3.06 cm.',
    metadata: { parameter: 'waterLevel', sensor_snapshot: { water_depth_cm: 3.05, value: 3, thresholds: { waterLevelMin: 3.06 } } } }];
}

test('every current Web page shows the canonical 3.05 cm with unchanged raw data', async ({ page, qa }) => {
  setup(qa); const raw = structuredClone(qa.data);
  for (const [route, selector] of routes) {
    await page.goto(route);
    const card = page.locator(selector).filter({ hasText: 'Water Level' });
    await expect(card).toContainText('3.05 cm');
    await expect(card).not.toContainText(/\b3\.0\s*cm\b/);
    await expect(card.locator('.safety-status')).toHaveText('Normal');
    if (route === '/admin/readings') await expect(page.locator('.modern-reading-table-row [data-label="Water Level"]')).toContainText('3.05 cm');
  }
  expect(qa.data).toEqual(raw); expect(qa.writes).toEqual([]);
});

test('Alerts, notification bell, Tank Details and activity use the event own precise snapshot', async ({ page, qa }) => {
  setup(qa); const raw = structuredClone(qa.data.alerts);
  const message = 'Water level 3.05 cm is below the minimum of 3.06 cm.';
  await page.goto('/admin/alerts');
  await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.locator('.modern-notification-panel')).toContainText(message);
  await page.goto('/admin/tanks/tank-a');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.locator('.modern-tank-detail-list-row')).toContainText(message);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const event = page.locator('[data-activity-id="alerts:depth-alert"]');
  await expect(event).toContainText('Recorded reading: 3.05 cm');
  await expect(event).toContainText(message);
  expect(qa.data.alerts).toEqual(raw); expect(qa.writes).toEqual([]);
});

test('CSV and printable/PDF report preserve two-decimal water depth', async ({ page, qa }) => {
  setup(qa);
  await page.goto('/admin/reports');
  await expect(page.locator('.cray-report-metric-grid')).toContainText('3.05 cm');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await fs.readFile(await (await download).path(), 'utf8');
  expect(csv).toContain('3.05 cm');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print Report', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('3.05 cm');
  await popup.close(); expect(qa.writes).toEqual([]);
});

test('3.05 below a configured 3.051 minimum stays Warning across cards and recommendation', async ({ page, qa }) => {
  setup(qa);
  qa.data.threshold_settings[0].thresholds.waterLevelMin = 3.051;
  await page.goto('/admin');
  const card = page.locator('.farmer-water-item').filter({ hasText: 'Water Level' });
  await expect(card).toContainText('3.05 cm');
  await expect(card.locator('.safety-status')).toHaveText('Warning');
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const advice = page.locator('.sensor-recommendation[data-parameter="waterLevel"]');
  await expect(advice).toContainText('3.05 cm');
  await expect(advice.locator('.safety-status')).toHaveText('Warning');
  await expect(advice).toContainText('Raw comparison: 3.05 cm < 3.051 cm');
  expect(qa.data.sensor_readings[0].water_depth_cm).toBe(3.05); expect(qa.writes).toEqual([]);
});
