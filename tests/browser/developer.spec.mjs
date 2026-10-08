import { test, expect } from './fixtures.mjs';

test('developer URL rejects missing authentication before showing verification', async ({ page, qa, context }) => {
  qa.authenticated = false;
  await context.addInitScript(() => localStorage.removeItem('sb-qa-auth-token'));
  await page.goto('/developer'); await expect(page).toHaveURL('/login');
  expect(qa.developerRequests).toHaveLength(0);
});

test('ten logo clicks check the server, denied users never see OTP or developer tools', async ({ page, qa }) => {
  await page.goto('/admin');
  const logo = page.getByRole('button', { name: 'CrayThrive logo', exact: true });
  await expect(logo).toBeVisible();
  await logo.click({ clickCount: 9 }); expect(qa.developerRequests).toHaveLength(0);
  await logo.click();
  await expect(page.getByRole('alert')).toContainText('Developer access is unavailable');
  await expect(page).toHaveURL('/admin');
  expect(qa.developerRequests).toHaveLength(1);
  expect(qa.developerRequests[0].body).toEqual({});
  expect(qa.developerRequests[0].authorization).toMatch(/^Bearer /);
  expect(qa.authRequests.some(path => path.includes('/factors'))).toBe(false);
});

test('direct developer URL and forged localStorage flags still require server authorization', async ({ page, qa, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('developerMode', 'true'); localStorage.setItem('isDeveloper', 'true');
    localStorage.setItem('role', 'super_admin');
  });
  await page.goto('/developer');
  await expect(page.getByRole('heading', { name: 'Developer Mode' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Developer access is unavailable');
  await expect(page.getByRole('button', { name: /verification|authenticator|restore|backup/i })).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('alert')).toContainText('Developer access is unavailable');
  expect(qa.developerRequests).toHaveLength(2);
});

test('authorized UUID proceeds through OTP and requires a second server confirmation', async ({ page, qa }) => {
  qa.developerAuthorized = true;
  await page.goto('/admin'); await page.getByRole('button', { name: 'CrayThrive logo', exact: true }).click({ clickCount: 10 });
  await expect(page).toHaveURL('/developer');
  await page.getByRole('button', { name: 'Continue verification' }).click();
  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Verification could not be completed');
  await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByText('Identity verified', { exact: true })).toBeVisible();
  await expect(page.getByText('Backup and Restore are not configured in this version.')).toBeVisible();
  expect(qa.developerRequests.length).toBeGreaterThanOrEqual(5);
  expect(qa.writes).toEqual([]);
});

test('authorized account can explicitly enroll its own authenticator, with no developer management UI', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerFactors = [];
  await page.goto('/developer');
  await page.getByRole('button', { name: 'Continue verification' }).click();
  await expect(page.getByText('No authenticator is configured for this account.')).toBeVisible();
  expect(qa.authRequests.some(path => path.endsWith('/factors'))).toBe(false);
  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  const qrImage = page.getByRole('img', { name: 'Authenticator setup QR code' });
  await expect(qrImage).toBeVisible();
  await expect.poll(() => qrImage.evaluate(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
  await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByText('Identity verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /add developer|manage developers|super.admin/i })).toHaveCount(0);
});

test('access revoked after page load blocks OTP from starting', async ({ page, qa }) => {
  qa.developerAuthorized = true; await page.goto('/developer');
  await expect(page.getByRole('button', { name: 'Continue verification' })).toBeVisible();
  qa.developerAuthorized = false;
  await page.getByRole('button', { name: 'Continue verification' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(qa.authRequests.some(path => path.includes('/factors'))).toBe(false);
});

for (const width of [390, 768, 1366]) {
  test(`developer OTP fits ${width}px`, async ({ page, qa }) => {
    qa.developerAuthorized = true; await page.setViewportSize({ width, height: 900 });
    await page.goto('/developer'); await page.getByRole('button', { name: 'Continue verification' }).click();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
