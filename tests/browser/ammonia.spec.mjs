import fs from 'node:fs/promises';
import { test, expect } from './fixtures.mjs';

const scanDate = '2025-01-02T09:00:00Z';
const waterDate = '2026-10-05T10:00:00Z';
const routes = ['/admin', '/admin/tanks', '/admin/tanks/tank-a', '/admin/readings', '/admin/reports'];
const metrics = '.farmer-water-item,.modern-tank-sensor-card,.modern-tank-detail-metric,.modern-reading-metric,.cray-report-metric-grid > div';
function setup(qa) {
  qa.data.tanks = [qa.data.tanks[0]];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], ph_value: 7.2, water_depth_cm: 5, created_at: waterDate }];
  qa.data.ammonia_readings = [{ ...qa.data.ammonia_readings[0], ammonia: 0.7, ammonia_status: 'Normal', created_at: scanDate }];
}
async function open(page, route = '/admin/reports') {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}
async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function download(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), text: await fs.readFile(await file.path(), 'utf8') };
}
async function print(page) {
  const pending = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print Report', exact: true }).click();
  const popup = await pending;
  await expect.poll(() => popup.evaluate(() => window.__qaPrintCalled)).toBe(true);
  return popup;
}

test('older manual critical scan agrees across all current monitoring screens', async ({ page, qa }) => {
  setup(qa);
  for (const route of routes) {
    await open(page, route);
    const ammonia = page.locator(metrics).filter({ hasText: 'Latest available ammonia scan' });
    await expect(ammonia).toHaveCount(1);
    await expect(ammonia).toContainText('0.7');
    await expect(ammonia).toContainText('2025');
    await expect(ammonia.locator('.safety-status')).toHaveText('Critical');
    await expect(ammonia.locator('.safety-status')).toHaveClass(/critical/);
    await expect(ammonia).not.toContainText('2026');
    expect(qa.reads.some(r => r.table === 'ammonia_readings' && r.filters.tank_id === 'eq.tank-a' && r.filters.limit === '1')).toBe(true);
  }
  expect(qa.writes).toEqual([]);
});

test('historical date filter excludes older scan while current CSV and PDF retain its own date', async ({ page, qa }) => {
  setup(qa);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByLabel('From Date', { exact: true }).fill('2026-10-05');
  await page.getByLabel('To Date', { exact: true }).fill('2026-10-05');
  await expect(page.locator('.monitoring-ammonia-history')).toContainText('No ammonia scan recorded during this period.');
  await expect(page.locator('.cray-report-metric-grid')).toContainText('0.70 mg/L');
  const history = await download(page);
  expect(history.text).toContain('Water Reading');
  expect(history.text).not.toContain('Ammonia Reading');
  expect(history.text).not.toContain('0.70 mg/L');
  const historyPrint = await print(page);
  await expect(historyPrint.locator('body')).toContainText('Water Readings');
  await expect(historyPrint.locator('body')).toContainText('Ammonia Scans');
  await expect(historyPrint.locator('body')).toContainText('No ammonia scan recorded during this period.');
  await expect(historyPrint.locator('body')).not.toContainText('0.70 mg/L');
  await historyPrint.pdf({ path: '.security-ammonia-period-history.pdf', preferCSSPageSize: true, printBackground: true });
  await historyPrint.close();
  await choose(page, 'Choose monitoring export data', 'Tank data: Latest Tank Status');
  await expect(page.locator('.monitoring-ammonia-history')).toContainText('No ammonia scan recorded during this period.');
  const current = await download(page);
  expect(current.name).toBe('craythrive-all-tanks-report-latest-status.csv');
  expect(current.text).toContain('Current Tank Status');
  expect(current.text).toContain('Sensor Date');
  expect(current.text).toContain('Ammonia Scan Date');
  expect(current.text).toContain('2025');
  expect(current.text).toContain('2026');
  expect(current.text).toContain('0.70 mg/L,Critical');
  expect(current.text).not.toContain('Water Reading');
  const currentPrint = await print(page);
  await expect(currentPrint.locator('.snapshot-card')).toContainText('Latest Available Ammonia Scan');
  const scan = currentPrint.locator('.snapshot-grid > section').filter({ hasText: 'Latest Available Ammonia Scan' });
  await expect(scan).toContainText('2025');
  await expect(scan).not.toContainText('2026');
  await expect(scan).toContainText('Critical');
  expect(await currentPrint.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await currentPrint.pdf({ path: '.security-ammonia-current-status.pdf', preferCSSPageSize: true, printBackground: true });
  await currentPrint.close();
  expect(qa.writes).toEqual([]);
});

test('one scan remains one event beside several water uploads', async ({ page, qa }) => {
  setup(qa);
  qa.data.sensor_readings = Array.from({ length: 3 }, (_, i) => ({ ...qa.data.sensor_readings[0], id: `water-${i}`, created_at: `2026-10-0${5 - i}T10:00:00Z` }));
  await open(page, '/admin/readings');
  const rows = page.locator('.modern-reading-table-body .modern-reading-table-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Ammonia Reading' })).toHaveCount(1);
  await open(page);
  const csv = await download(page);
  expect(csv.text.match(/Ammonia Reading/g)).toHaveLength(1);
  expect(csv.text.match(/Water Reading/g)).toHaveLength(3);
  const popup = await print(page);
  await expect(popup.locator('tbody tr')).toHaveCount(4);
  await popup.close();
});

test('missing scans remain neutral and actual zero scan remains Normal', async ({ page, qa }) => {
  setup(qa);
  qa.data.ammonia_readings = [];
  for (const route of routes) {
    await open(page, route);
    const ammonia = page.locator(metrics).filter({ hasText: 'Latest available ammonia scan' });
    await expect(ammonia.locator('.safety-status')).toHaveText('No Scan');
    await expect(ammonia).not.toContainText('0.00');
  }
  qa.data.ammonia_readings = [{ tank_id: 'tank-a', user_id: qa.data.profiles[0].id, ammonia: 0, created_at: scanDate }];
  await open(page, '/admin/tanks/tank-a');
  await expect(page.locator('.modern-tank-detail-metric').filter({ hasText: 'Latest available ammonia scan' })).toContainText('Normal');
  expect(qa.writes).toEqual([]);
});

test('quiet tank scan survives a global history limit and never takes another tank scan', async ({ page, qa }) => {
  const old = { ...qa.data.ammonia_readings[0], ammonia: 0.7, created_at: scanDate };
  qa.data.ammonia_readings = [...Array.from({ length: 1001 }, (_, i) => ({ ...qa.data.ammonia_readings[1], id: `busy-${i}`, ammonia: 0.1 })), old];
  qa.data.sensor_readings[0].ph_value = 7.2;
  qa.data.sensor_readings[0].water_depth_cm = 5;
  for (const route of ['/admin/tanks/tank-a', '/admin/tanks', '/admin/reports']) {
    await open(page, route);
    if (route === '/admin/reports') await choose(page, 'Choose which tank to include in the report', 'Tank A');
    const ammonia = page.locator(metrics).filter({ hasText: 'Latest available ammonia scan' }).filter({ hasText: '2025' });
    await expect(ammonia).toHaveCount(1);
    await expect(ammonia.locator('.safety-status')).toHaveText('Critical');
  }
  await page.getByLabel('From Date', { exact: true }).fill('2025-01-02');
  await page.getByLabel('To Date', { exact: true }).fill('2025-01-02');
  await expect(page.locator('.monitoring-ammonia-history')).toContainText('1 manual scan records');
  await expect(page.locator('.monitoring-ammonia-history')).toContainText('0.70 mg/L');
  const csv = await download(page);
  expect(csv.text.match(/Ammonia Reading/g)).toHaveLength(1);
  expect(qa.writes).toEqual([]);
});

test('saved ammonia threshold refresh changes the existing scan status without a new upload', async ({ page, qa }) => {
  setup(qa);
  await open(page, '/admin/tanks');
  await expect(page.locator('.modern-tank-card-top .safety-status')).toHaveText('Critical');
  const before = structuredClone(qa.data.ammonia_readings);
  qa.data.threshold_settings[0].thresholds.ammoniaMax = 0.8;
  for (const route of routes) {
    await open(page, route);
    const ammonia = page.locator(metrics).filter({ hasText: 'Latest available ammonia scan' });
    await expect(ammonia.locator('.safety-status')).toHaveText('Normal');
    await expect(ammonia).toContainText('2025');
  }
  expect(qa.data.ammonia_readings).toEqual(before);
  expect(qa.writes).toEqual([]);
});

test('ammonia-only tank shows its scan and overall condition without fabricating sensor data', async ({ page, qa }) => {
  setup(qa);
  qa.data.sensor_readings = [];
  for (const route of routes) {
    await open(page, route);
    const ammonia = page.locator(metrics).filter({ hasText: 'Latest available ammonia scan' });
    await expect(ammonia.locator('.safety-status')).toHaveText('Critical');
    await expect(page.locator('.modern-admin-content')).toContainText('No Data');
  }
  expect(qa.writes).toEqual([]);
});
