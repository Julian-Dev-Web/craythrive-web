import { test, expect, user, session } from './fixtures.mjs';

async function open(page, route = '/admin/tanks/tank-a') {
  await page.goto(route);
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Recommendations', exact: true });
  await expect(panel.locator('.sensor-recommendation')).toHaveCount(5);
  return panel;
}
test('automatic recommendation refresh keeps the explicitly generated answer without another AI call', async ({ page, qa }) => {
  await page.clock.install();
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  const answer = panel.locator('.sensor-recommendations-ai-answer');
  await expect(answer).toContainText('Check this tank with a fresh measurement');
  const reads = qa.reads.filter(read => read.table === 'get_tank_threshold_settings').length;
  await page.clock.runFor(31000);
  await expect.poll(() => qa.reads.filter(read => read.table === 'get_tank_threshold_settings').length).toBeGreaterThan(reads);
  await expect(panel.getByRole('button', { name: 'Refresh recommendations', exact: true })).toBeEnabled();
  await expect(answer).toContainText('Check this tank with a fresh measurement');
  expect(qa.aiGuideRequests).toHaveLength(1);
  expect(qa.writes).toEqual([]);
});

test('live reading changes retain the answer, mark it outdated and use no extra subscriptions or AI calls', async ({ page, qa }) => {
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  const answer = panel.locator('.sensor-recommendations-ai-answer');
  await expect(answer).toContainText('Check this tank');
  const channels = qa.realtimeJoinCount;
  const row = { ...qa.data.sensor_readings[0], id: 'new-observation', water_depth_cm: 3.05, created_at: new Date().toISOString() };
  qa.data.sensor_readings.unshift(row);
  qa.emitReading('sensor_readings', row);
  await expect(panel.locator('.sensor-recommendation[data-parameter="waterLevel"]')).toContainText('3.05 cm');
  await expect(answer).toContainText('Check this tank');
  await expect(answer).toContainText('Outdated');
  expect(qa.aiGuideRequests).toHaveLength(1);
  expect(qa.realtimeJoinCount).toBe(channels);
  qa.aiGuideResponse = { message: 'New explanation using the updated observation.' };
  await panel.getByRole('button', { name: 'Refresh AI Recommendation', exact: true }).click();
  await expect(answer).toContainText('New explanation');
  await expect(answer).not.toContainText('Outdated');
  await panel.getByText('Previous AI recommendations (1)', { exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-history')).toContainText('Check this tank');
  expect(qa.aiGuideRequests).toHaveLength(2);
  expect(qa.writes).toEqual([]);
});

test('closing the panel, changing tank tabs, manual refresh, navigation and browser reload restore saved answers', async ({ page, qa }) => {
  let panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  await expect(panel.locator('time').last()).toBeVisible();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Asia/Manila');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Recommendations', exact: true });
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  await page.keyboard.press('Escape');
  await page.goto('/admin/tanks');
  panel = await open(page);
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  await page.reload();
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  expect(qa.aiGuideRequests).toHaveLength(1);
  expect(qa.writes).toEqual([]);
});

test('each tank restores its own history and repeated explicit generation preserves previous answers', async ({ page, qa }) => {
  qa.aiGuideResponse = { message: 'Explanation for Tank A only.' };
  const panel = await open(page, '/admin');
  await panel.getByLabel('Tank', { exact: true }).selectOption('tank-a');
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Tank A only');
  await panel.getByLabel('Tank', { exact: true }).selectOption('tank-b');
  await expect(panel.locator('.sensor-recommendation-tank').first()).toHaveText('Tank B');
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toHaveCount(0);
  qa.aiGuideResponse = { message: 'Explanation for Tank B only.' };
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Tank B only');
  await panel.getByLabel('Tank', { exact: true }).selectOption('tank-a');
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Tank A only');
  await expect(panel.locator('.sensor-recommendations-ai-answer')).not.toContainText('Tank B');
  expect(qa.aiGuideRequests).toHaveLength(2);
  expect(qa.writes).toEqual([]);
});

test('network verification failure preserves the previous answer as outdated while blocking regeneration', async ({ page, qa }) => {
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  qa.thresholdReadFailure = true;
  await panel.getByRole('button', { name: 'Refresh recommendations', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('could not be verified');
  await expect(panel.locator('.sensor-recommendation')).toHaveCount(0);
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Outdated');
  await expect(panel.getByRole('button', { name: 'Refresh AI Recommendation', exact: true })).toBeDisabled();
  qa.thresholdReadFailure = false;
  await panel.getByRole('button', { name: 'Retry recommendations', exact: true }).click();
  await expect(panel.locator('.sensor-recommendation')).toHaveCount(5);
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  expect(qa.aiGuideRequests).toHaveLength(1);
  expect(qa.writes).toEqual([]);
});

test('saved threshold changes mark the existing answer outdated without automatically calling AI', async ({ page, qa }) => {
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  qa.data.threshold_settings[0].thresholds.waterLevelMin = 0.5;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const water = panel.locator('.sensor-recommendation[data-parameter="waterLevel"]');
  await expect(water).toContainText('Safe Limit: ≥ 0.5 cm');
  await expect(water.locator('.safety-status')).toHaveText('Normal');
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Outdated');
  expect(qa.aiGuideRequests).toHaveLength(1);
});

test('ordinary logout clears saved explanations before a later sign-in', async ({ page, qa }) => {
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('craythrive:ai-explanations:')))).toEqual([]);
  qa.authenticated = true;
  await open(page);
  await expect(page.locator('.sensor-recommendations-ai-answer')).toHaveCount(0);
  expect(qa.aiGuideRequests).toHaveLength(1);
});

test('closing and reopening during an in-flight explanation does not duplicate or lose the request', async ({ page, qa }) => {
  qa.aiGuideDelay = 1500;
  let panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect.poll(() => qa.aiGuideRequests?.length || 0).toBe(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Recommendations', exact: true });
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  expect(qa.aiGuideRequests).toHaveLength(1);
  expect(qa.writes).toEqual([]);
});

test('three minutes of visible control/data polling do not reload or remount Tank Details', async ({ page, qa }) => {
  await page.clock.install();
  await page.goto('/admin/tanks/tank-a');
  const root = page.locator('.modern-tank-detail-page');
  await expect(root).toBeVisible();
  await page.waitForLoadState('networkidle');
  await root.evaluate(element => { element.dataset.mountProbe = 'same-tank-instance'; });
  const profiles = qa.reads.filter(read => read.table === 'profiles').length;
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.clock.runFor(180000);
  await expect(root).toHaveAttribute('data-mount-probe', 'same-tank-instance');
  expect(navigations).toBe(0);
  expect(qa.reads.filter(read => read.table === 'profiles')).toHaveLength(profiles);
  expect(qa.aiGuideRequests || []).toEqual([]);
  expect([...qa.realtimeChannels.keys()].filter(key => key.includes('monitoring:'))).toHaveLength(1);
  expect(qa.writes).toEqual([]);
});

test('switching accounts clears the previous account explanation and never restores it for the next owner', async ({ page, qa }) => {
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Explain with AI Guide', exact: true }).click();
  await expect(panel.locator('.sensor-recommendations-ai-answer')).toContainText('Check this tank');
  const other = { ...user, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.invalid' };
  qa.authUser = other;
  qa.data.profiles = [{ ...other, role: 'user' }];
  qa.data.tanks = [{ ...qa.data.tanks[0], user_id: other.id, name: 'Other owner tank' }];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], user_id: other.id }];
  qa.data.ammonia_readings = [];
  await page.evaluate(fakeSession => {
    localStorage.setItem('sb-qa-auth-token', JSON.stringify(fakeSession));
    const channel = new BroadcastChannel('sb-qa-auth-token'); channel.postMessage({ event: 'SIGNED_IN', session: fakeSession }); channel.close();
  }, { ...session, user: other });
  await expect(page.locator('.modern-tank-detail-hero')).toContainText('Other owner tank');
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.locator('.sensor-recommendation')).toHaveCount(5);
  await expect(page.locator('.sensor-recommendations-ai-answer')).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('craythrive:ai-explanations:')));
  expect(keys.some(key => key.includes(user.id))).toBe(false);
  expect(qa.aiGuideRequests).toHaveLength(1);
});
