import { test, expect, user, session } from './fixtures.mjs';

const timestamp = '2026-10-11T02:00:00Z';
const metrics = '.farmer-water-item,.modern-tank-sensor-card,.modern-tank-detail-metric,.modern-reading-metric,.cray-report-metric-grid > div';
const routes = ['/admin', '/admin/tanks', '/admin/tanks/tank-a', '/admin/readings', '/admin/reports'];
const metric = (page, name) => page.locator(metrics).filter({ hasText: name });
const monitoringChannels = qa => [...qa.realtimeChannels.keys()].filter(topic => topic.includes('monitoring:'));
function setup(qa) {
  qa.serverTime = timestamp;
  qa.data.tanks = [qa.data.tanks[0]];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], id: 'z', temperature_c: 26.36, ph_value: 7.35,
    turbidity_voltage: 2.85, water_depth_cm: 5, water_status: 'SAFE_IDEAL', created_at: timestamp }];
  qa.data.ammonia_readings = [{ ...qa.data.ammonia_readings[0], ammonia: undefined, ammonia_level: 0.1,
    created_at: '2025-01-01T00:00:00Z' }];
}
async function open(page, qa, route = '/admin') {
  await page.goto(route);
  await expect(metric(page, 'Temperature')).toContainText('26.4');
  await expect.poll(() => monitoringChannels(qa).length).toBe(1);
  await page.waitForLoadState('networkidle');
}
async function resume(page) { await page.evaluate(() => window.dispatchEvent(new Event('online'))); }

test('all Web monitoring pages select the same canonical row with stable ties, units and Philippine time', async ({ page, qa }) => {
  setup(qa);
  qa.data.sensor_readings.unshift({ ...qa.data.sensor_readings[0], id: 'a', temperature_c: 99, ph_value: 1 });
  for (const route of routes) {
    await open(page, qa, route);
    for (const [name, value] of [['Temperature', '26.4'], ['pH Level', '7.35'], ['Water Clarity', '2.85 V'], ['Water Level', '5.00 cm']]) {
      await expect(metric(page, name)).toContainText(value);
      await expect(metric(page, name).locator('.safety-status')).toHaveText('Normal');
    }
    await expect(page.locator('.monitoring-sync-notice')).toContainText('10:00 AM (Asia/Manila)');
    await expect(metric(page, /Ammonia|ammonia/)).toContainText('0.10 mg/L');
    await expect(metric(page, /Ammonia|ammonia/).locator('.safety-status')).toHaveText('Manual Scan');
  }
  const requests = qa.reads.filter(r => r.table === 'sensor_readings' && r.filters.limit === '1');
  expect(requests.length).toBeGreaterThanOrEqual(5);
  expect(requests.every(r => r.filters.tank_id === 'eq.tank-a' && r.filters.user_id === `eq.${user.id}`
    && r.filters.order === 'created_at.desc.nullslast,id.desc')).toBe(true);
  expect(qa.writes).toEqual([]);
});

test('a latest row with missing calibrated fields does not borrow old pH or ADC/distance values', async ({ page, qa }) => {
  setup(qa);
  qa.data.sensor_readings.push({ ...qa.data.sensor_readings[0], id: 'old', created_at: '2026-10-10T02:00:00Z' });
  Object.assign(qa.data.sensor_readings[0], { ph_value: null, ph: null, ph_voltage: 3, raw_ph_value: 2000,
    turbidity_voltage: null, turbidity: null, raw_turbidity_value: 3000,
    water_depth_cm: null, water_level: null, water_distance_cm: 20 });
  for (const route of routes) {
    await open(page, qa, route);
    for (const name of ['pH Level', 'Water Clarity', 'Water Level']) {
      await expect(metric(page, name)).toContainText('No reading');
      await expect(metric(page, name).locator('.safety-status')).toHaveText('No Data');
    }
  }
});

test('INSERT and UPDATE refresh the snapshot without reloading account/page datasets', async ({ page, qa }) => {
  setup(qa);
  await open(page, qa, '/admin/readings');
  const tankReads = qa.reads.filter(r => r.table === 'tanks').length;
  const inserted = { ...qa.data.sensor_readings[0], id: 'new', temperature_c: 28.2, created_at: '2026-10-11T01:59:59Z' };
  // Still newest: move the original backwards without altering the chosen upload.
  qa.data.sensor_readings[0].created_at = '2026-10-10T02:00:00Z';
  qa.data.sensor_readings.push(inserted);
  qa.emitReading('sensor_readings', inserted, 'INSERT');
  await expect(metric(page, 'Temperature')).toContainText('28.2');
  inserted.temperature_c = 29.1;
  qa.emitReading('sensor_readings', inserted, 'UPDATE');
  await expect(metric(page, 'Temperature')).toContainText('29.1');
  expect(qa.reads.filter(r => r.table === 'tanks').length).toBe(tankReads);
  expect(monitoringChannels(qa)).toHaveLength(1);
  expect(qa.writes).toEqual([]);
});

test('tank-specific realtime updates cannot put Tank B measurements in Tank A', async ({ page, qa }) => {
  setup(qa);
  qa.data.tanks.push({ id: 'tank-b', user_id: user.id, name: 'Tank B', device_uid: 'device-b' });
  qa.data.sensor_readings.push({ ...qa.data.sensor_readings[0], id: 'b', tank_id: 'tank-b', device_uid: 'device-b', temperature_c: 27 });
  await open(page, qa, '/admin/tanks/tank-a');
  const count = qa.reads.filter(r => r.table === 'sensor_readings' && r.filters.limit === '1').length;
  qa.data.sensor_readings[1].temperature_c = 31;
  qa.emitReading('sensor_readings', qa.data.sensor_readings[1], 'UPDATE');
  await page.waitForTimeout(400);
  await expect(metric(page, 'Temperature')).toContainText('26.4');
  expect(qa.reads.filter(r => r.table === 'sensor_readings' && r.filters.limit === '1').length).toBe(count);
  await page.goto('/admin/tanks/tank-b');
  await expect(metric(page, 'Temperature')).toContainText('31.0');
  await expect.poll(() => monitoringChannels(qa).length).toBe(1);
});

test('a slow obsolete response cannot overwrite a newer reading after resume', async ({ page, qa }) => {
  setup(qa);
  qa.currentReadingDelays = [2000];
  await page.goto('/admin');
  await expect.poll(() => qa.reads.some(r => r.table === 'sensor_readings' && r.filters.limit === '1')).toBe(true);
  qa.data.sensor_readings[0].temperature_c = 28.7;
  await resume(page);
  await expect(metric(page, 'Temperature')).toContainText('28.7');
  await page.waitForTimeout(2100);
  await expect(metric(page, 'Temperature')).toContainText('28.7');
  expect(qa.writes).toEqual([]);
});

test('realtime reconnect re-queries authoritative rows and navigation disposes monitoring channels', async ({ page, qa }) => {
  setup(qa);
  await open(page, qa);
  const joins = qa.realtimeJoinCount;
  qa.disconnectRealtime();
  qa.data.sensor_readings[0].temperature_c = 28.6;
  await expect(metric(page, 'Temperature')).toContainText('28.6');
  await expect.poll(() => qa.realtimeJoinCount).toBeGreaterThan(joins);
  await page.getByRole('link', { name: 'Tanks', exact: true }).first().click();
  await expect(metric(page, 'Temperature')).toContainText('28.6');
  await expect.poll(() => monitoringChannels(qa).length).toBe(1);
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect.poll(() => monitoringChannels(qa).length).toBe(0);
});

test('external threshold updates refresh a visible page within the fallback interval without a new upload', async ({ page, qa }) => {
  setup(qa);
  await page.clock.install();
  await open(page, qa, '/admin/tanks');
  qa.data.tank_threshold_settings.push({ tank_id: 'tank-a', user_id: user.id,
    thresholds: { ...qa.data.threshold_settings[0].thresholds, waterLevelMin: 6 } });
  await page.clock.runFor(61000);
  await expect(metric(page, 'Water Level')).toContainText('Safe Limit: ≥ 6 cm');
  await expect(metric(page, 'Water Level').locator('.safety-status')).toHaveText('Warning');
  qa.data.tank_threshold_settings[0].thresholds.waterLevelMin = 4;
  await resume(page);
  await page.clock.runFor(250);
  await expect(metric(page, 'Water Level').locator('.safety-status')).toHaveText('Normal');
  expect(qa.writes).toEqual([]);
});

test('all current cards are neutral for stale uploads while historical measurements remain intact', async ({ page, qa }) => {
  setup(qa);
  qa.data.sensor_readings[0].created_at = '2025-01-01T00:00:00Z';
  for (const route of routes) {
    await open(page, qa, route);
    for (const name of ['Temperature', 'pH Level', 'Water Clarity', 'Water Level']) {
      await expect(metric(page, name).locator('.safety-status')).toHaveText('Stale');
      await expect(metric(page, name).locator('.safety-status')).toHaveClass(/no-data/);
    }
    await expect(page.locator('.monitoring-sync-notice')).toContainText('Stale sensor reading');
  }
  expect(qa.data.sensor_readings[0].temperature_c).toBe(26.36);
});

test('failed current queries expose retry and never present bounded history as a current Normal reading', async ({ page, qa }) => {
  setup(qa);
  qa.currentReadingFailure = true;
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Retry readings' })).toBeVisible({ timeout: 20000 });
  await expect(metric(page, 'Temperature')).toContainText('No reading');
  await expect(metric(page, 'Temperature').locator('.safety-status')).toHaveText('No Data');
  qa.currentReadingFailure = false;
  await page.getByRole('button', { name: 'Retry readings' }).click();
  await expect(metric(page, 'Temperature')).toContainText('26.4');
});

test('ammonia realtime uses its own same-tank scan source and timestamp, never embedded sensor ammonia', async ({ page, qa }) => {
  setup(qa);
  qa.data.sensor_readings[0].ammonia = 99;
  await open(page, qa);
  const scan = { id: 'new-scan', tank_id: 'tank-a', user_id: user.id, ammonia_level: 0.35,
    created_at: '2026-10-10T02:00:00Z' };
  qa.data.ammonia_readings.push(scan);
  qa.emitReading('ammonia_readings', scan);
  const card = metric(page, /Ammonia|ammonia/);
  await expect(card).toContainText('0.35 mg/L');
  await expect(card).toContainText('Oct 10, 2026');
  await expect(card.locator('.safety-status')).toHaveText('Manual Scan');
  await expect(card).not.toContainText('99');
});

test('auth refresh re-queries readings without duplicate subscriptions, and sign-out clears monitoring', async ({ page, qa }) => {
  setup(qa);
  await open(page, qa);
  const joins = qa.realtimeJoinCount;
  qa.data.sensor_readings[0].temperature_c = 28.4;
  await page.evaluate(fakeSession => {
    const channel = new BroadcastChannel('sb-qa-auth-token');
    channel.postMessage({ event: 'TOKEN_REFRESHED', session: fakeSession });
    channel.close();
  }, session);
  await expect(metric(page, 'Temperature')).toContainText('28.4');
  expect(qa.realtimeJoinCount).toBe(joins);
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(() => monitoringChannels(qa).length).toBe(0);
});

test('a fresh upload becomes stale while the page remains open, without changing its numeric value', async ({ page, qa }) => {
  setup(qa);
  await open(page, qa);
  await expect(metric(page, 'Temperature').locator('.safety-status')).toHaveText('Normal');
  qa.serverTime = '2026-10-11T02:06:00Z';
  await resume(page);
  await expect(metric(page, 'Temperature').locator('.safety-status')).toHaveText('Stale');
  await expect(metric(page, 'Temperature')).toContainText('26.4');
  await expect(page.locator('.monitoring-sync-notice')).toContainText('10:00 AM (Asia/Manila)');
  await expect(page.getByText('Current condition unavailable', { exact: true })).toBeVisible();
});
