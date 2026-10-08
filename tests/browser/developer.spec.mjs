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
  const request = qa.developerRequests.find(request => request.path.endsWith('/developer-backup') && request.body.action === 'export');
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
    qa.backupHistory = [historyEntry(1), historyEntry(2)];
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/developer'); await chooseBackup(page);
    await page.getByRole('button', { name: 'Preview restore', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

function historyEntry(index) {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, createdAt: new Date(Date.parse('2026-10-08T15:55:00Z') - index * 86400000).toISOString(),
    backupDay: '2026-10-08', source: 'automatic', recordCount: 1234, tableCount: 22, byteSize: 8192 };
}

test('daily history explains skipped days and downloads a previous backup through the protected endpoint', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true;
  qa.backupHistory = [historyEntry(1), historyEntry(2)];
  qa.backupLastRun = { checkedAt: new Date().toISOString(), source: 'automatic', status: 'skipped', reason: 'no_data_changes' };
  await page.goto('/developer');
  const history = page.getByRole('region', { name: 'Backup history', exact: true });
  await expect(history.getByText('Automatic backup: daily at 11:55 PM (Philippine time).')).toBeVisible();
  await expect(history.getByText(/No changes — skipped/)).toBeVisible();
  await expect(history.getByRole('listitem')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await history.getByRole('button', { name: /^Download backup from/ }).first().click();
  expect((await download).suggestedFilename()).toMatch(/\.ctbackup$/);
  expect(qa.developerRequests.find(request => request.body.action === 'download').body).toEqual({ action: 'download', id: qa.backupHistory[0].id });
  expect(qa.developerRequests.find(request => request.body.action === 'download').authorization).toMatch(/^Bearer /);
});

test('previous backup can be selected for preview without applying restore', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true; qa.backupHistory = [historyEntry(1)];
  await page.goto('/developer');
  const history = page.getByRole('region', { name: 'Backup history', exact: true });
  const recovery = page.waitForEvent('download');
  await history.getByRole('button', { name: /^Preview restore from/ }).click();
  expect((await recovery).suggestedFilename()).toContain('craythrive-recovery');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore data', exact: true })).toBeDisabled();
  expect(qa.developerRequests.some(request => request.body.action === 'apply')).toBe(false);
});

test('unchanged manual download keeps history intact and explains deduplication', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true; qa.backupHistory = [historyEntry(1)]; qa.backupUnchanged = true;
  await page.goto('/developer');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No changes since the saved backup');
  await expect(page.getByRole('region', { name: 'Backup history', exact: true }).getByRole('listitem')).toHaveCount(1);
  expect(qa.backupHistory).toHaveLength(1);
});

test('older backups load in pages without dropping current history', async ({ page, qa }) => {
  qa.developerAuthorized = true; qa.developerVerified = true;
  qa.backupHistory = Array.from({ length: 25 }, (_, index) => historyEntry(index + 1));
  await page.goto('/developer');
  const history = page.getByRole('region', { name: 'Backup history', exact: true });
  await expect(history.getByRole('listitem')).toHaveCount(20);
  await history.getByRole('button', { name: 'Load older backups', exact: true }).click();
  await expect(history.getByRole('listitem')).toHaveCount(25);
  await expect(history.getByRole('button', { name: 'Load older backups', exact: true })).toHaveCount(0);
});
