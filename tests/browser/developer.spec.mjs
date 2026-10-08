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
  await expect(page.getByRole('button', { name: 'Download backup', exact: true })).toBeVisible();
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

const qaBackup = { format: 'craythrive-backup', version: 1, iv: 'qa-only-iv', ciphertext: 'qa-only-encrypted-fixture' };
async function chooseBackup(page) {
  await page.getByLabel('CrayThrive backup file').setInputFiles({ name: 'qa.ctbackup', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(qaBackup)) });
  await expect(page.getByRole('button', { name: 'Preview restore', exact: true })).toBeEnabled();
}

test('verified developer downloads encrypted backup with current authorization', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true;
  await page.goto('/developer');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^craythrive-backup-.*\.ctbackup$/);
  await expect(page.getByRole('status')).toContainText('Encrypted backup downloaded');
  const request = qa.developerRequests.find(request => request.path.endsWith('/developer-backup'));
  expect(request.body).toEqual({ action: 'export' }); expect(request.authorization).toMatch(/^Bearer /);
});

test('restore previews and downloads recovery before requiring explicit confirmation', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true;
  await page.goto('/developer'); await chooseBackup(page);
  const recovery = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Preview restore', exact: true }).click();
  expect((await recovery).suggestedFilename()).toMatch(/^craythrive-recovery-.*\.ctbackup$/);
  await expect(page.getByRole('table')).toBeVisible();
  const restore = page.getByRole('button', { name: 'Restore data', exact: true });
  await expect(restore).toBeDisabled();
  expect(qa.developerRequests.some(request => request.body.action === 'apply')).toBe(false);
  await page.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await expect(restore).toBeDisabled();
  await page.getByLabel('I saved the recovery backup and reviewed the changes.').check();
  await restore.click();
  await expect(page.getByRole('status')).toContainText('Restore completed');
  const request = qa.developerRequests.find(request => request.body.action === 'apply');
  expect(request.body.backup).toEqual(qaBackup); expect(request.body.confirmation).toBe('RESTORE');
  expect(request.body.previewToken.ciphertext).toBe('qa-only-preview-proof');
});

test('malformed upload is rejected before contacting the restore endpoint', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true;
  await page.goto('/developer');
  await page.getByLabel('CrayThrive backup file').setInputFiles({ name: 'wrong.ctbackup', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('valid CrayThrive');
  await expect(page.getByRole('button', { name: 'Preview restore', exact: true })).toBeDisabled();
  expect(qa.developerRequests.some(request => request.path.endsWith('/developer-restore'))).toBe(false);
});

test('expired server authorization removes tools and returns to authenticator verification', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true;
  await page.goto('/developer');
  await expect(page.getByRole('button', { name: 'Download backup', exact: true })).toBeVisible();
  qa.developerOperationStatus = 403;
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue verification', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download backup', exact: true })).toHaveCount(0);
});

test('server operation failure shows an error without claiming restore success', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true;
  await page.goto('/developer'); await chooseBackup(page);
  qa.developerOperationStatus = 503;
  await page.getByRole('button', { name: 'Preview restore', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('operation could not be completed');
  await expect(page.getByText('Restore completed.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore data', exact: true })).toHaveCount(0);
});

for (const width of [390, 768, 1366]) {
  test(`backup and restore preview fit ${width}px`, async ({ page, qa }) => {
    qa.developerAuthorized = true; qa.developerVerified = true;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/developer'); await chooseBackup(page);
    await page.getByRole('button', { name: 'Preview restore', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
