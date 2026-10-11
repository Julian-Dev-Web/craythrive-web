import { test, expect, user } from './fixtures.mjs';

const timestamp = '2026-10-11T02:00:00Z';
function setup(qa) {
  qa.serverTime = timestamp;
  qa.data.sensor_readings.forEach(row => { row.created_at = timestamp; });
  qa.data.ammonia_readings.forEach(row => { row.created_at = '2025-01-02T09:00:00Z'; });
  qa.data.tank_threshold_settings = [
    { user_id: user.id, tank_id: 'tank-a', thresholds: { ...qa.data.threshold_settings[0].thresholds } },
    { user_id: user.id, tank_id: 'tank-b', thresholds: { ...qa.data.threshold_settings[0].thresholds, waterLevelMin: 3 } },
  ];
}
async function open(page, route = '/admin', tankName = 'Tank A') {
  await page.goto(route);
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Recommendations', exact: true });
  if (tankName) await panel.getByLabel('Tank', { exact: true }).selectOption({ label: tankName });
  await expect(panel.locator('.sensor-recommendation')).toHaveCount(5);
  return panel;
}
const card = (panel, parameter) => panel.locator(`.sensor-recommendation[data-parameter="${parameter}"]`);

test('Dashboard and Tank Details produce equivalent sorted, tank-specific recommendations without writes', async ({ page, qa }) => {
  setup(qa);
  const raw = structuredClone(qa.data.sensor_readings);
  let first;
  for (const route of ['/admin', '/admin/tanks/tank-a']) {
    const panel = await open(page, route);
    await expect(card(panel, 'ph')).toContainText('below the configured minimum (6.5)');
    await expect(card(panel, 'ph').locator('.safety-status')).toHaveText('Critical');
    await expect(card(panel, 'waterLevel').locator('.safety-status')).toHaveText('Warning');
    await expect(card(panel, 'waterLevel')).toContainText('Safe Limit: ≥ 4.5 cm');
    await expect(card(panel, 'temperature')).toContainText('26.3 °C');
    await expect(card(panel, 'temperature').locator('.safety-status')).toHaveText('Normal');
    await expect(card(panel, 'temperature')).toContainText('10:00 AM (Asia/Manila)');
    await expect(card(panel, 'ammonia')).toContainText('2025');
    await expect(card(panel, 'ammonia')).toContainText('No scan-validity period is configured');
    await expect(card(panel, 'ammonia').locator('.safety-status')).toHaveText('Unavailable');
    const results = await panel.locator('.sensor-recommendation').allTextContents();
    if (!first) first = results;
    else expect(results).toEqual(first);
    expect(await panel.locator('.sensor-recommendation').first().getAttribute('data-parameter')).toBe('ph');
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
  }
  expect(qa.data.sensor_readings).toEqual(raw);
  expect(qa.writes).toEqual([]);
  expect(qa.aiGuideRequests || []).toEqual([]);
});

test('switching tanks cannot reuse another tank reading or threshold', async ({ page, qa }) => {
  setup(qa);
  const panel = await open(page);
  await panel.getByLabel('Tank', { exact: true }).selectOption('tank-b');
  await expect(card(panel, 'waterLevel')).toContainText('Safe Limit: ≥ 3 cm');
  await expect(card(panel, 'waterLevel')).toContainText('5.0 cm');
  await expect(card(panel, 'waterLevel').locator('.safety-status')).toHaveText('Normal');
  for (const item of await panel.locator('.sensor-recommendation-tank').all()) await expect(item).toHaveText('Tank B');
  await expect(panel.getByRole('status')).toContainText('No verified current Warning or Critical readings');
  expect(qa.reads.some(read => read.table === 'sensor_readings' && read.filters.tank_id === 'eq.tank-b' && read.filters.user_id === `eq.${user.id}`)).toBe(true);
  expect(qa.writes).toEqual([]);
});

test('an explicit tank choice survives a late Dashboard snapshot changing its suggested tank', async ({ page, qa }) => {
  setup(qa);
  qa.currentReadingDelays = [2500, 2500];
  await page.goto('/admin');
  await expect.poll(() => qa.reads.filter(read => read.table === 'sensor_readings' && read.filters.limit === '1').length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Recommendations', exact: true });
  await panel.getByLabel('Tank', { exact: true }).selectOption('tank-a');
  await expect(page.locator('.monitoring-sync-notice')).toContainText('Latest sensor reading');
  await expect(panel.getByLabel('Tank', { exact: true })).toHaveValue('tank-a');
  await expect(card(panel, 'waterLevel')).toContainText('Safe Limit: ≥ 4.5 cm');
  await expect(panel.locator('.sensor-recommendation-tank')).toHaveText(Array(5).fill('Tank A'));
  expect(qa.writes).toEqual([]);
});

test('Apply refreshes recommendations across tabs using unchanged readings and keeps the other tank isolated', async ({ page, context, qa }) => {
  setup(qa);
  const raw = structuredClone(qa.data.sensor_readings);
  const panel = await open(page, '/admin/tanks/tank-a');
  const settings = await context.newPage();
  await settings.goto('/admin/settings');
  await settings.getByLabel('Tank', { exact: true }).selectOption('tank-a');
  await settings.getByLabel('Minimum Water Level value').fill('0.5');
  await settings.getByRole('button', { name: 'Apply to This Tank', exact: true }).first().click();
  await expect(settings.getByText('Threshold settings updated for Tank A.', { exact: true })).toBeVisible();
  await expect(card(panel, 'waterLevel')).toContainText('Safe Limit: ≥ 0.5 cm');
  await expect(card(panel, 'waterLevel').locator('.safety-status')).toHaveText('Normal');
  expect(qa.data.tank_threshold_settings.find(row => row.tank_id === 'tank-b').thresholds.waterLevelMin).toBe(3);
  expect(qa.data.sensor_readings).toEqual(raw);
  expect(qa.writes.filter(write => write.table === 'device_commands')).toEqual([]);
  await settings.close();
});

test('old, carried and missing measurements prompt verification instead of false Normal advice', async ({ page, qa }) => {
  setup(qa);
  qa.data.sensor_readings[0].created_at = '2025-01-01T00:00:00Z';
  qa.data.ammonia_readings = [];
  const panel = await open(page, '/admin/tanks/tank-a');
  await expect(card(panel, 'temperature').locator('.safety-status')).toHaveText('Stale');
  await expect(card(panel, 'temperature')).toContainText('cannot establish the current water condition');
  await expect(card(panel, 'ammonia')).toContainText('No recent ammonia reading');
  await expect(panel.locator('.sensor-recommendation .safety-status.normal')).toHaveCount(0);
  qa.data.sensor_readings[0].created_at = timestamp;
  qa.data.sensor_readings[0].water_status = 'SAFE_IDEAL';
  qa.data.sensor_readings[0].raw_payload = { water_value_source: 'last_good', water_measurement_fresh: false };
  await panel.getByRole('button', { name: 'Refresh recommendations', exact: true }).click();
  await expect(card(panel, 'waterLevel').locator('.safety-status')).toHaveText('Stale');
  await expect(card(panel, 'temperature').locator('.safety-status')).toHaveText('Normal');
  expect(qa.writes).toEqual([]);
});

test('failed threshold verification clears recommendations and supports a safe retry', async ({ page, qa }) => {
  setup(qa);
  const panel = await open(page);
  qa.thresholdReadFailure = true;
  await panel.getByRole('button', { name: 'Refresh recommendations', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Readings or thresholds could not be verified');
  await expect(panel.locator('.sensor-recommendation')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Explain with AI Guide' })).toHaveCount(0);
  qa.thresholdReadFailure = false;
  await panel.getByRole('button', { name: 'Retry recommendations' }).click();
  await expect(panel.locator('.sensor-recommendation')).toHaveCount(5);
  expect(qa.writes).toEqual([]);
});

test('AI explanation is opt-in text, cannot reclassify data or offer an executable action', async ({ page, qa }) => {
  setup(qa);
  qa.aiGuideResponse = { message: 'Verify pH using a fresh test. <script>window.bad=true</script>',
    severity: 'normal', action_type: 'suggest_fill', threshold_suggestion: { waterLevelMin: 99 } };
  const panel = await open(page, '/admin/tanks/tank-a');
  const before = await panel.locator('.sensor-recommendation').allTextContents();
  expect(qa.aiGuideRequests || []).toEqual([]);
  await panel.getByRole('button', { name: 'Explain with AI Guide' }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Verify pH using a fresh test.');
  expect(await panel.locator('.sensor-recommendation').allTextContents()).toEqual(before);
  await expect(panel.locator('script')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Apply|Refill|Drain|Feed/i })).toHaveCount(0);
  expect(qa.aiGuideRequests).toHaveLength(1);
  const body = qa.aiGuideRequests[0].body;
  expect(body.context.tank.id).toBe('tank-a');
  expect(body.context.capabilities.automatic_actions).toBe(false);
  expect(body.context.latest_ammonia.condition).toBe('Unavailable');
  expect(body.context.rule_based_result.recommendations[0].severity).toBe('critical');
  expect(qa.writes).toEqual([]);
});

test('AI failure leaves deterministic recommendations usable', async ({ page, qa }) => {
  setup(qa);
  qa.aiGuideStatus = 429;
  qa.aiGuideResponse = { error: 'Rate limited' };
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide' }).click();
  await expect(panel.getByRole('alert')).toContainText('Please wait before trying again');
  await expect(card(panel, 'ph').locator('.safety-status')).toHaveText('Critical');
  await expect(panel.locator('.sensor-recommendation')).toHaveCount(5);
  expect(qa.writes).toEqual([]);
});

test('phone, tablet and desktop panel stays accessible, fits the viewport and restores focus', async ({ page, qa }) => {
  setup(qa);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const panel = await open(page, '/admin/tanks/tank-a');
    const rect = await panel.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(901);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await panel.getByRole('button', { name: 'Close recommendations', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    expect(await panel.evaluate(element => element.contains(document.activeElement))).toBe(true);
    if (width === 360) await page.screenshot({ path: '.security-recommendations-phone.png' });
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Recommendations', exact: true })).toBeFocused();
  }
  expect(qa.writes).toEqual([]);
});

test('a dashboard with no tanks explains why recommendations are empty', async ({ page, qa }) => {
  setup(qa);
  qa.data.tanks = [];
  qa.data.sensor_readings = [];
  qa.data.ammonia_readings = [];
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('No tanks available');
  expect(qa.writes).toEqual([]);
});

test('the floating launcher leaves the emergency control accessible on phone and desktop', async ({ page, qa }) => {
  setup(qa);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/tanks/tank-a');
    await page.getByRole('button', { name: 'Controls', exact: true }).click();
    const stop = page.getByRole('button', { name: /Emergency Stop/ });
    await stop.scrollIntoViewIfNeeded();
    expect(await stop.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    expect(await page.locator('.sensor-recommendations-page').evaluate(element => parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThanOrEqual(80);
  }
  expect(qa.writes).toEqual([]);
});
