import { test, expect, user } from './fixtures.mjs';

async function open(page) {
  await page.goto('/admin/tanks/add');
  await expect(page.getByRole('heading', { name: 'Add Tank', exact: true })).toBeVisible();
}
const writes = qa => qa.writes.filter(write => write.table === 'tanks');

test('breeder creates one shared row, refreshes list, and remains Unpaired / No Data', async ({ page, qa }) => {
  const forbidden = [];
  page.on('request', request => { if (['/api/tank-schema', '/rest/v1/'].includes(new URL(request.url()).pathname)) forbidden.push(request.url()); });
  await page.goto('/admin/tanks');
  await page.getByRole('link', { name: 'Add Tank', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tank summary' })).toContainText('1 male + 2 females');
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByLabel('Tank Name').fill('  Breeder Tank 1  ');
  await page.getByLabel('Notes (optional)').fill('  Shared notes  ');
  await page.getByRole('button', { name: 'Create Tank', exact: true }).click();
  await expect(page).toHaveURL('/admin/tanks');
  await expect(page.getByRole('status')).toContainText('Breeder Tank 1 was created');
  const card = page.locator('.modern-tank-card').filter({ has: page.getByRole('heading', { name: 'Breeder Tank 1', exact: true }) });
  await expect(card).toContainText('1 male + 2 females');
  await expect(card).toContainText('Unpaired'); await expect(card).toContainText('No Data');
  await expect(card).not.toContainText('Normal');
  expect(writes(qa)).toHaveLength(1);
  expect(writes(qa)[0].body).toEqual({ user_id: user.id, tank_name: 'Breeder Tank 1', tank_type: 'Breeder', male_count: 1, female_count: 2, juvenile_count: 0, notes: 'Shared notes', status: 'Unpaired', has_paired_device: false });
  await page.reload(); await expect(card).toBeVisible();
  await page.goto(`/admin/tanks/${qa.data.tanks.at(-1).id}`);
  await expect(page.locator('.modern-admin-content')).toContainText('1 male + 2 females');
  await expect(page.locator('.modern-tank-detail-hero-card')).toContainText('No Data');
  expect(forbidden).toEqual([]);
});

for (const count of [15, 20]) {
  test(`juvenile ${count} summary matches persisted counters and refreshed list`, async ({ page, qa }) => {
    await open(page);
    await page.getByRole('radio', { name: /Juvenile/ }).check();
    await expect(page.getByLabel('Juvenile Count')).toHaveValue('15');
    await expect(page.getByText('Recommended: 15 to 20 crayfish.')).toBeVisible();
    await page.getByLabel('Tank Name').fill(`Juvenile Tank ${count}`);
    await page.getByLabel('Juvenile Count').fill(String(count));
    await expect(page.getByRole('region', { name: 'Tank summary' })).toContainText(`${count} juveniles`);
    await page.getByRole('button', { name: 'Create Tank', exact: true }).click();
    await expect(page).toHaveURL('/admin/tanks');
    const card = page.locator('.modern-tank-card').filter({ hasText: `Juvenile Tank ${count}` });
    await expect(card).toContainText(`${count} juveniles`);
    expect(writes(qa)[0].body).toMatchObject({ tank_type: 'Juvenile', male_count: 0, female_count: 0, juvenile_count: count, has_paired_device: false });
    await page.reload(); await expect(card).toContainText(`${count} juveniles`);
  });
}

test('invalid name/count never writes and switching type preserves entered juvenile count', async ({ page, qa }) => {
  await open(page);
  await page.getByLabel('Tank Name').fill('   ');
  await page.getByRole('button', { name: 'Create Tank', exact: true }).click();
  await expect(page.getByText('Enter a tank name.', { exact: true })).toBeVisible();
  await page.getByLabel('Tank Name').fill('Juvenile Tank 1');
  await page.getByRole('radio', { name: /Juvenile/ }).check();
  for (const count of ['', '-1', '15.5', '2147483648']) {
    await page.getByLabel('Juvenile Count').fill(count);
    await page.getByRole('button', { name: 'Create Tank', exact: true }).click();
    await expect(page.locator('#create-tank-count-error')).toBeVisible();
  }
  await page.getByLabel('Juvenile Count').fill('20');
  await page.getByRole('radio', { name: /Breeder/ }).check();
  await expect(page.getByRole('region', { name: 'Tank summary' })).toContainText('1 male + 2 females');
  await page.getByRole('radio', { name: /Juvenile/ }).check();
  await expect(page.getByLabel('Juvenile Count')).toHaveValue('20');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL('/admin/tanks'); expect(writes(qa)).toHaveLength(0);
});

test('rapid duplicate submit produces only one insert', async ({ page, qa }) => {
  qa.tankWriteDelay = 700;
  await open(page); await page.getByLabel('Tank Name').fill('Single Tank');
  await page.getByRole('form', { name: 'Add tank' }).evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByRole('button', { name: /Creating/ })).toBeDisabled();
  await expect(page).toHaveURL('/admin/tanks'); expect(writes(qa)).toHaveLength(1);
});

test('RLS errors preserve entries and permit a deliberate retry without setup requests', async ({ page, qa }) => {
  await open(page); qa.tankWriteFailure = true;
  await page.getByLabel('Tank Name').fill('Retry Tank');
  await page.getByRole('button', { name: 'Create Tank', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Tank Name')).toHaveValue('Retry Tank');
  expect(writes(qa)).toHaveLength(1);
  qa.tankWriteFailure = false;
  await page.getByRole('button', { name: 'Create Tank', exact: true }).click();
  await expect(page).toHaveURL('/admin/tanks'); expect(writes(qa)).toHaveLength(2);
});

test('expired auth before submit does not insert', async ({ page, qa }) => {
  await open(page); qa.expired = true;
  await page.getByLabel('Tank Name').fill('Unsaved Tank');
  await page.getByRole('button', { name: 'Create Tank', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please sign in again');
  expect(writes(qa)).toHaveLength(0);
});

test('existing mobile-shaped rows use shared counters and user-scoped list/detail queries', async ({ page, qa }) => {
  qa.data.tanks = [
    { id: 'mobile-breeder', user_id: user.id, tank_name: 'Mobile Breeder', tank_type: 'Breeder', male_count: 1, female_count: 2, juvenile_count: 0, has_paired_device: false, status: 'Unpaired' },
    { id: 'mobile-juvenile', user_id: user.id, tank_name: 'Mobile Juvenile', tank_type: 'Juvenile', male_count: 0, female_count: 0, juvenile_count: 20, has_paired_device: false, status: 'Unpaired' },
    { id: 'other-owner', user_id: 'another-owner', tank_name: 'Private Tank', tank_type: 'Juvenile', juvenile_count: 99 },
  ];
  await page.goto('/admin/tanks');
  await expect(page.locator('.modern-tank-card').filter({ hasText: 'Mobile Breeder' })).toContainText('1 male + 2 females');
  await expect(page.locator('.modern-tank-card').filter({ hasText: 'Mobile Juvenile' })).toContainText('20 juveniles');
  await expect(page.locator('.modern-admin-content')).not.toContainText('Private Tank');
  await page.goto('/admin/tanks/mobile-juvenile');
  await expect(page.locator('.modern-admin-content')).toContainText('20 juveniles');
  expect(writes(qa)).toHaveLength(0);
});

for (const width of [390, 768, 1366]) {
  for (const theme of ['light', 'dark']) {
  test(`Add Tank fits ${width}px ${theme} with usable inputs and no planning controls`, async ({ page, qa, context }) => {
    await context.addInitScript(theme => localStorage.setItem('craythrive_dashboard_theme', theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    for (const type of ['Breeder', 'Juvenile']) {
      await page.getByRole('radio', { name: new RegExp(type) }).check();
      await expect(page.getByRole('button', { name: 'Create Tank', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.getByLabel(/length|width|height|shelters|water depth/i)).toHaveCount(0);
    if (width === 390 || width === 1366) await page.screenshot({ path: `.security-tank-create-${width}-${theme}.png`, fullPage: true });
    expect(writes(qa)).toHaveLength(0);
  });
  }
}
