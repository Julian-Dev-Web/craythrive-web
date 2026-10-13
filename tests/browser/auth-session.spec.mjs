import { test, expect, user, session } from './fixtures.mjs';

const monitoringChannels = qa => [...qa.realtimeChannels.keys()].filter(topic => topic.includes('monitoring:'));
const hasStoredSession = page => page.evaluate(() => !!localStorage.getItem('sb-qa-auth-token'));

test('Web restores on refresh; ordinary signOut is local and disposes realtime', async ({ page, qa }) => {
  await page.goto('/admin/readings');
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible();
  await expect.poll(() => monitoringChannels(qa).length).toBe(1);
  await page.reload();
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible();
  await expect.poll(() => monitoringChannels(qa).length).toBe(1);
  const checks = qa.authRequests.filter(path => path.endsWith('/user')).length;
  for (let i = 0; i < 3; i++) await page.evaluate(fakeSession => {
    const channel = new BroadcastChannel('sb-qa-auth-token');
    channel.postMessage({ event: 'TOKEN_REFRESHED', session: fakeSession }); channel.close();
  }, session);
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible();
  expect(qa.authRequests.filter(path => path.endsWith('/user')).length).toBe(checks);
  expect(monitoringChannels(qa)).toHaveLength(1);
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(qa.authLogoutScopes).toEqual(['local']);
  await expect.poll(() => monitoringChannels(qa).length).toBe(0);
});

for (const failure of ['authUserFailure', 'profileFailure']) test(`temporary ${failure} does not revoke or redirect a restored session`, async ({ page, qa }) => {
  qa[failure] = true;
  await page.goto('/admin/readings');
  await expect(page.getByRole('heading', { name: 'Could not verify your connection' })).toBeVisible({ timeout: 15000 });
  expect(await hasStoredSession(page)).toBe(true);
  expect(qa.authLogoutScopes || []).toEqual([]);
  expect(qa.reads.filter(read => read.table === 'sensor_readings')).toHaveLength(0);
  await expect(page).toHaveURL(/\/admin\/readings$/);
  qa[failure] = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible();
  expect(qa.authLogoutScopes || []).toEqual([]);
});

test('profile outage after explicit login keeps the newly created session and never uses global logout', async ({ page, qa }) => {
  qa.profileFailure = true;
  await page.goto('/login');
  await page.getByPlaceholder('name@example.com').fill('farmer@example.invalid');
  await page.getByPlaceholder('Enter your password').fill('qa-password-never-a-real-password');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByText('Could not verify your CrayThrive profile. Reconnect and retry.', { exact: true })).toBeVisible({ timeout: 15000 });
  expect(qa.authLogoutScopes || []).toEqual([]);
  expect(await hasStoredSession(page)).toBe(true);
  qa.profileFailure = false;
  await page.goto('/admin/readings');
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible();
});

test('SDK refreshes an expired access session and recovers from a transient refresh outage', async ({ page, context, qa }) => {
  await context.addInitScript(expiredSession => localStorage.setItem('sb-qa-auth-token', JSON.stringify(expiredSession)),
    { ...session, expires_at: Math.floor(Date.now() / 1000) - 60 });
  qa.refreshFailure = true;
  await page.goto('/admin/readings');
  await expect.poll(() => qa.authRefreshCount || 0).toBeGreaterThan(0);
  expect(await hasStoredSession(page)).toBe(true);
  expect(qa.authLogoutScopes || []).toEqual([]);
  qa.refreshFailure = false;
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible({ timeout: 15000 });
  expect(qa.authRefreshCount).toBeLessThanOrEqual(3);
  await expect(page).toHaveURL(/\/admin\/readings$/);
});

test('logout failure keeps the dashboard and gives a retryable error', async ({ page, qa }) => {
  await page.goto('/admin/readings');
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible();
  qa.logoutFailure = true;
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.locator('.session-error-notice')).toContainText('Could not sign out');
  await expect(page).toHaveURL(/\/admin\/readings$/);
  expect(await hasStoredSession(page)).toBe(true);
  qa.logoutFailure = false;
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(qa.authLogoutScopes).toEqual(['local', 'local']);
});

test('definitive invalid identity and denied profiles never expose protected tank data', async ({ page, qa }) => {
  qa.expired = true;
  await page.goto('/admin/readings');
  await expect(page).toHaveURL(/\/login$/);
  expect(qa.reads.some(read => read.table === 'sensor_readings')).toBe(false);
  qa.expired = false;
  qa.data.profiles[0].role = 'unsupported';
  await page.goto('/admin/readings');
  await expect(page.getByRole('heading', { name: 'Dashboard access unavailable' })).toBeVisible();
  expect(qa.authLogoutScopes || []).toEqual([]);
});

test('account switch clears protected state and recreates owner-filtered subscriptions', async ({ page, qa }) => {
  await page.goto('/admin/readings');
  await expect(page.locator('.modern-reading-metric-grid')).toBeVisible();
  await expect.poll(() => monitoringChannels(qa).length).toBe(1);
  const other = { ...user, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.invalid' };
  await page.waitForLoadState('networkidle');
  qa.authUser = other;
  qa.data.profiles = [{ ...other, role: 'user', username: 'Other Farmer' }];
  qa.data.tanks = [{ id: 'other-tank', user_id: other.id, name: 'Other Tank' }];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], id: 'other-reading', user_id: other.id, tank_id: 'other-tank', temperature_c: 29.2 }];
  qa.data.ammonia_readings = [];
  const readBoundary = qa.reads.length;
  await page.evaluate(fakeSession => {
    localStorage.setItem('sb-qa-auth-token', JSON.stringify(fakeSession));
    const channel = new BroadcastChannel('sb-qa-auth-token');
    channel.postMessage({ event: 'SIGNED_IN', session: fakeSession }); channel.close();
  }, { ...session, user: other });
  await expect(page.getByRole('article', { name: 'Latest Temperature', exact: true })).toContainText('29.2');
  await expect(page.locator('.modern-readings-page')).toContainText('Other Tank');
  await expect(page.locator('.modern-readings-page')).not.toContainText('Tank A');
  await expect.poll(() => monitoringChannels(qa)).toEqual([expect.stringContaining(`monitoring:${other.id}:`)]);
  const newReads = qa.reads.slice(readBoundary).filter(read => ['tanks', 'sensor_readings', 'ammonia_readings'].includes(read.table));
  expect(newReads.length).toBeGreaterThan(0);
  expect(newReads.every(read => {
    const scopes = Object.entries(read.filters).filter(([key]) => ['user_id', 'owner_id', 'profile_id', 'created_by', 'farmer_id'].includes(key));
    return scopes.length > 0 && scopes.every(([, value]) => value === `eq.${other.id}`);
  })).toBe(true);
  expect(qa.writes).toEqual([]);
});
