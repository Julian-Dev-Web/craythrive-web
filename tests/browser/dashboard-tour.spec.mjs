import { test, expect, session } from './fixtures.mjs';

const titles = ['Welcome to CrayThrive', 'Manage Your Tanks', 'Monitor Tank Conditions', 'Review Monitoring History', 'Generate Reports', 'Crayfish Marketplace', 'Settings & Thresholds'];
const routes = ['/admin', '/admin/tanks', '/admin/tanks/tank-a', '/admin/readings', '/admin/reports', '/admin/marketplace', '/admin/settings'];
const dialog = page => page.getByRole('dialog');

async function login(page) {
  await page.goto('/login');
  await page.getByPlaceholder('name@example.com').fill('farmer@example.invalid');
  await page.getByPlaceholder('Enter your password').fill('qa-password-never-a-real-password');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL('/admin');
}
async function replay(page) {
  await page.goto('/admin/settings');
  await page.getByRole('region', { name: 'Help & Learning' }).getByRole('button', { name: 'Take a Tour', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function checkStep(page, index, route = routes[index]) {
  await expect(page).toHaveURL(route);
  await expect(dialog(page).getByRole('heading')).toHaveText(titles[index]);
  await expect(dialog(page)).toContainText(`${index + 1} of 7`);
}

test('fresh successful login offers an optional invitation once, with skip preserved across navigation, reload and token refresh', async ({ page, qa }) => {
  qa.invalidLogin = true;
  await loginAttempt();
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('craythrive_web_tour_login'))).toBeNull();
  qa.invalidLogin = false;
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Welcome to CrayThrive', exact: true })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip for Now' }).click();
  await page.getByRole('link', { name: 'Tanks', exact: true }).first().click();
  await page.getByRole('link', { name: 'Overview', exact: true }).first().click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  // The production bundle has no source imports/test globals. Deliver the same
  // cross-tab refresh event Auth JS consumes, without adding a production hook.
  await page.evaluate(session => {
    const channel = new BroadcastChannel('sb-qa-auth-token');
    channel.postMessage({ event: 'TOKEN_REFRESHED', session }); channel.close();
  }, session);
  await page.reload();
  await expect(page.locator('.farmer-overview-page')).toBeVisible();
  await expect(page.locator('.dashboard-tour-invitation')).toHaveCount(0);
  expect(qa.writes).toEqual([]);
  async function loginAttempt() {
    await page.goto('/login');
    await page.getByPlaceholder('name@example.com').fill('farmer@example.invalid');
    await page.getByPlaceholder('Enter your password').fill('qa-password-never-a-real-password');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
  }
});

test('subsequent explicit login offers a small dismissible refresher, not an automatic tour', async ({ page, qa }) => {
  await login(page);
  await page.getByRole('button', { name: 'Skip for Now' }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await login(page);
  const invite = page.getByRole('region', { name: 'Welcome back!', exact: true });
  await expect(invite).toBeVisible();
  await expect(invite).not.toHaveClass(/is-first/);
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Maybe Later' }).click();
  await page.reload();
  await expect(page.locator('.farmer-overview-page')).toBeVisible();
  await expect(page.locator('.dashboard-tour-invitation')).toHaveCount(0);
  expect(qa.writes).toEqual([]);
});

test('restored session and direct links show no login invitation; an undismissed invitation is not repeated after leaving', async ({ page, qa }) => {
  await page.goto('/admin/tanks');
  await page.goto('/admin');
  await expect(page.locator('.farmer-overview-page')).toBeVisible();
  await expect(page.locator('.dashboard-tour-invitation')).toHaveCount(0);
  await login(page);
  await expect(page.locator('.dashboard-tour-invitation')).toBeVisible();
  await page.getByRole('link', { name: 'Tanks', exact: true }).first().click();
  await page.getByRole('link', { name: 'Overview', exact: true }).first().click();
  await expect(page.locator('.dashboard-tour-invitation')).toHaveCount(0);
  expect(qa.writes).toEqual([]);
});

test('complete all seven real routes, use Back, and replay after finishing without data writes', async ({ page, qa }) => {
  await login(page);
  await page.getByRole('button', { name: 'Take a Tour', exact: true }).click();
  await checkStep(page, 0);
  await expect(dialog(page).getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  for (let i = 1; i < 7; i++) {
    if (i === 2) await expect(page.locator('[data-tour="tank-details-link"]').first()).toBeAttached();
    await dialog(page).getByRole('button', { name: 'Next', exact: true }).click();
    await checkStep(page, i);
  }
  await dialog(page).getByRole('button', { name: 'Back', exact: true }).click(); await checkStep(page, 5);
  await dialog(page).getByRole('button', { name: 'Next', exact: true }).click(); await checkStep(page, 6);
  await dialog(page).getByRole('button', { name: 'Finish Tour', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('craythrive_web_tour_completed'))).toBe('true');
  await page.getByRole('region', { name: 'Help & Learning' }).getByRole('button', { name: 'Take a Tour' }).click();
  await checkStep(page, 0);
  await dialog(page).getByRole('button', { name: 'Skip Tour', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(qa.writes).toEqual([]);
});

test('zero tanks and missing DOM targets use information cards without fake records', async ({ page, qa }) => {
  qa.data.tanks = []; qa.data.sensor_readings = []; qa.data.ammonia_readings = [];
  await replay(page);
  await dialog(page).getByRole('button', { name: 'Next', exact: true }).click(); await checkStep(page, 1);
  await expect(page.locator('[data-tour="add-tank"]')).toBeAttached();
  await dialog(page).getByRole('button', { name: 'Next', exact: true }).click(); await checkStep(page, 2, '/admin/tanks');
  await expect(dialog(page)).toContainText('No tank needs to be created');
  await expect(page.getByTestId('tour-spotlight')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Next', exact: true }).click(); await checkStep(page, 3);
  await expect(page.getByTestId('tour-spotlight')).toBeVisible();
  await page.locator('[data-tour="readings-overview"]').evaluate(element => element.remove());
  await expect(page.getByTestId('tour-spotlight')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Skip Tour' }).click();
  await expect(page.locator('.admin-dashboard-shell')).not.toHaveAttribute('inert');
  expect(qa.writes).toEqual([]); expect(qa.errors).toEqual([]);
});

test('keyboard Enter advances, Tab stays in the temporary dialog, Escape closes and releases focus', async ({ page, qa }) => {
  await replay(page); await checkStep(page, 0);
  await expect(dialog(page).getByRole('button', { name: 'Next', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await checkStep(page, 1);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    expect(await dialog(page).evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.admin-dashboard-shell')).not.toHaveAttribute('inert');
  await expect(page.locator('.modern-admin-content')).toBeFocused();
  await page.reload(); await expect(dialog(page)).toHaveCount(0);
  await replay(page); await checkStep(page, 0);
  expect(qa.writes).toEqual([]);
});

test('logout from another tab removes the tour and restores normal page interaction', async ({ page, qa }) => {
  await replay(page); await checkStep(page, 0);
  await page.evaluate(() => {
    const channel = new BroadcastChannel('sb-qa-auth-token');
    channel.postMessage({ event: 'SIGNED_OUT', session: null }); channel.close();
  });
  await expect(page).toHaveURL('/login');
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  expect(await page.evaluate(() => sessionStorage.getItem('craythrive_web_tour_login'))).toBeNull();
  expect(qa.writes).toEqual([]);
});

test('spotlight follows the actual target after resizing from desktop to phone', async ({ page, qa }) => {
  await replay(page); await checkStep(page, 0);
  await expect(page.getByTestId('tour-spotlight')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog(page).getByRole('button', { name: 'Next', exact: true })).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => {
    const box = await page.getByTestId('tour-spotlight').boundingBox();
    const target = await page.locator('[data-tour="dashboard-overview"]').boundingBox();
    return Math.abs(box.width - (target.width + 10)) < 2;
  }).toBe(true);
  expect(qa.writes).toEqual([]);
});

for (const [width, height] of [[390, 844], [768, 1024], [1366, 768], [1440, 900]]) {
  for (const theme of ['light', 'dark']) {
    test(`all tour steps fit ${width}x${height} ${theme}`, async ({ page, qa, context }) => {
      await context.addInitScript(({ theme }) => localStorage.setItem('craythrive_dashboard_theme', theme), { theme });
      await page.setViewportSize({ width, height });
      await replay(page);
      if (width === 390) await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
      for (let i = 0; i < 7; i++) {
        await checkStep(page, i);
        if (i === 2) await expect(page.locator('[data-tour="tank-monitoring"]')).toBeAttached();
        await expect(page.getByTestId('tour-spotlight')).toBeVisible();
        for (const control of ['Skip Tour', 'Back', i === 6 ? 'Finish Tour' : 'Next']) {
          await expect(dialog(page).getByRole('button', { name: control, exact: true })).toBeInViewport({ ratio: 1 });
        }
        const bounds = await dialog(page).boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (theme === 'dark' && ((width === 390 && i === 1) || (width === 1440 && i === 0))) {
          await page.screenshot({ path: `.security-tour-${width}-${theme}.png` });
        }
        if (i === 1) await expect(page.locator('[data-tour="tank-details-link"]').first()).toBeAttached();
        await dialog(page).getByRole('button', { name: i === 6 ? 'Finish Tour' : 'Next', exact: true }).click();
      }
      await expect(dialog(page)).toHaveCount(0);
      expect(qa.writes).toEqual([]); expect(qa.errors).toEqual([]);
    });
  }
}
