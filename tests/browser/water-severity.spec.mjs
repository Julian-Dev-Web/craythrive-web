import { test, expect } from './fixtures.mjs';

const pages = [
  ['/admin', '.farmer-water-item', '.farmer-status-content h2'],
  ['/admin/tanks', '.modern-tank-sensor-card', '.modern-tank-card-top .safety-status'],
  ['/admin/tanks/tank-a', '.modern-tank-detail-metric', '.modern-tank-safety-banner strong'],
  ['/admin/readings', '.modern-reading-metric', '.modern-safety-banner strong'],
  ['/admin/reports', '.cray-report-metric-grid > div', '.cray-report-metric-grid'],
];

function prepare(qa, overrides = {}) {
  qa.data.tanks = [qa.data.tanks[0]];
  qa.data.ammonia_readings = [];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], temperature_c: 26.3,
    ph_value: 7.2, turbidity_voltage: 2.8, water_depth_cm: 4,
    water_status: undefined, ...overrides }];
}

for (const [status, label] of [
  ['SAFE_IDEAL', 'Normal'], ['LOW_WARNING', 'Warning'], ['HIGH_WARNING', 'Warning'],
  ['CRITICAL_LOW', 'Critical'], ['CRITICAL_HIGH', 'Critical'],
]) {
  test(`firmware ${status} agrees across monitoring pages`, async ({ page, qa }) => {
    prepare(qa, { water_status: status, water_depth_cm: status === 'SAFE_IDEAL' ? 4.6 : 4 });
    for (const [route, selector, overall] of pages) {
      await page.goto(route);
      const water = page.locator(selector).filter({ hasText: 'Water Level' });
      await expect(water).toContainText(status === 'SAFE_IDEAL' ? '4.60 cm' : '4.00 cm');
      await expect(water.locator('.safety-status')).toHaveText(label);
      await expect(water.locator('.safety-status')).toHaveClass(new RegExp(`\\b${label.toLowerCase()}\\b`));
      await expect(water.locator('.safety-status svg')).toBeVisible();
      if (route !== '/admin/reports') await expect(page.locator(overall)).toHaveText(label);
      else await expect(page.locator(overall).locator('..').locator(':scope > .safety-status')).toHaveText(label);
      if (route === '/admin/readings') {
        const row = page.locator('.modern-reading-table-row').filter({ hasText: 'Water Reading' });
        await expect(row.locator('[data-label="Water Level"] .safety-status')).toHaveText(label);
        await expect(row.locator('[data-label="Status"] .safety-status')).toHaveText(label);
      }
    }
    expect(qa.writes).toEqual([]);
  });
}

test('raw comparisons and saved minimum refresh agree without a new sensor upload', async ({ page, qa }) => {
  prepare(qa, { water_depth_cm: 3.99 });
  qa.data.threshold_settings[0].thresholds.waterLevelMin = 4;
  for (const [route, selector] of pages) {
    await page.goto(route);
    const water = page.locator(selector).filter({ hasText: 'Water Level' });
    await expect(water).toContainText('3.99 cm');
    await expect(water.locator('.safety-status')).toHaveText('Warning');
  }
  qa.data.threshold_settings[0].thresholds.waterLevelMin = 4.5;
  for (const [route, selector] of pages) {
    await page.goto(route);
    const water = page.locator(selector).filter({ hasText: 'Water Level' });
    await expect(water.locator('.safety-status')).toHaveText('Warning');
    if (route === '/admin/readings' || route === '/admin/tanks/tank-a') {
      await expect(page.locator('.modern-admin-content')).toContainText('3.99 cm is below the active tank minimum (4.50 cm)');
    }
  }
  expect(qa.data.sensor_readings[0].water_depth_cm).toBe(3.99);
  expect(qa.writes).toEqual([]);
});

test('temperature pH and clarity warning tiers survive every page summary', async ({ page, qa }) => {
  prepare(qa, { water_depth_cm: 5, temperature_c: 30.02, temperature_status: 'HOT_WARNING',
    ph_value: 6.37, ph_status: 'LOW_ACIDIC', turbidity_voltage: 2.184, turbidity_status: 'SLIGHTLY_CLOUDY' });
  for (const [route, selector, overall] of pages) {
    await page.goto(route);
    for (const name of ['Temperature', 'pH Level', 'Water Clarity']) {
      await expect(page.locator(selector).filter({ hasText: name }).locator('.safety-status')).toHaveText('Warning');
    }
    if (route !== '/admin/reports') await expect(page.locator(overall)).toHaveText('Warning');
  }
  expect(qa.writes).toEqual([]);
});
