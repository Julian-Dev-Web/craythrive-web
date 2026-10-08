import { test, expect, user } from './fixtures.mjs';

const values = { name: 'Web Juvenile Tank', lengthCm: '100', widthCm: '100', heightCm: '60', normalWaterDepthCm: '40', population: '5', shelters: '5', notes: 'PVC shelters ready' };
async function fill(page, overrides = {}) {
  for (const [name, value] of Object.entries({ ...values, ...overrides })) await page.locator(`[name="${name}"]`).fill(value);
}
async function open(page, path = '/admin/tanks/add') {
  await page.goto(path);
  await expect(page.getByRole('button', { name: path.endsWith('/edit') ? 'Save Changes' : 'Create Tank', exact: true })).toBeEnabled();
}

test('first tank creates under the authenticated owner without a device and persists after refresh', async ({ page, qa }) => {
  qa.data.tanks = [];
  await page.goto('/admin/tanks');
  await page.getByRole('link', { name: 'Add Tank', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create Tank', exact: true })).toBeEnabled();
  await fill(page);
  const guide = page.getByRole('region', { name: 'Tank Planning Guide' });
  await expect(guide).toContainText('5–15 advanced juveniles');
  await expect(guide.getByTestId('planning-area')).toHaveText('1 m²');
  await expect(guide.getByTestId('planning-volume')).toHaveText('400 L');
  await page.getByRole('button', { name: 'Create Tank' }).click();
  await expect(page).toHaveURL(/\/admin\/tanks\/qa-created-1$/);
  await expect(page.getByRole('heading', { name: values.name })).toBeVisible();
  await expect(guide).toContainText('Normal water depth (planned)40 cm');
  await expect(page.locator('.modern-tank-detail-hero-card')).toContainText('No Data');
  await expect(page.getByText('Unpaired', { exact: true })).toBeVisible();
  expect(qa.writes).toHaveLength(1);
  expect(qa.writes[0]).toEqual({ table: 'tanks', method: 'POST', body: {
    name: values.name, tank_type: 'juvenile', length_cm: 100, width_cm: 100, height_cm: 60, normal_water_depth_cm: 40,
    crayfish_count: 5, shelter_count: 5, notes: values.notes, user_id: user.id, is_paired: false,
  } });
  await page.reload();
  await expect(guide).toContainText('5–15 advanced juveniles');
  await page.getByRole('link', { name: 'Back to Tanks', exact: true }).click();
  const card = page.locator('.modern-tank-card').filter({ hasText: values.name });
  await expect(card).toContainText('Unpaired'); await expect(card.locator('.modern-tank-card-top .modern-tank-status')).toHaveText('No Data');
});

test('invalid inputs are retained and block writes, but above-reference warnings allow saving', async ({ page, qa }) => {
  await open(page);
  await page.getByRole('button', { name: 'Create Tank' }).click();
  await expect(page.getByText('Enter a tank name.', { exact: true })).toBeVisible();
  await fill(page, { lengthCm: '-1', normalWaterDepthCm: '70', population: '1.5', shelters: '-1' });
  await page.getByRole('button', { name: 'Create Tank' }).click();
  await expect(page.getByText('Normal water depth must not exceed tank height.')).toBeVisible();
  expect(qa.writes).toEqual([]);
  await fill(page, { population: '99', shelters: '99' });
  await expect(page.locator('.tank-planning-guide')).toContainText('above the juvenile reference range');
  await expect(page.locator('.tank-planning-guide .safety-status')).toHaveText('Warning');
  await page.getByRole('button', { name: 'Create Tank' }).click();
  await expect(page).toHaveURL(/qa-created-1$/);
  expect(qa.writes[0].body.crayfish_count).toBe(99);
});

test('breeder guide, small-tank caution, and repeated-submit guard', async ({ page, qa }) => {
  await open(page); await fill(page, { lengthCm: '10', widthCm: '10' });
  await expect(page.locator('.tank-planning-guide')).toContainText('below the reference floor area');
  await expect(page.locator('.tank-planning-guide')).not.toContainText('Around 0');
  await page.getByLabel('Tank type *', { exact: true }).selectOption('breeder');
  await fill(page, { population: '4' });
  await expect(page.locator('.tank-planning-guide')).toContainText('1 male + 2 females');
  await expect(page.locator('.tank-planning-guide')).not.toContainText('Estimated juvenile range');
  await expect(page.locator('.tank-planning-guide .safety-status')).toHaveText('Warning');
  qa.tankWriteDelay = 300;
  await page.getByRole('button', { name: 'Create Tank' }).dblclick();
  await expect(page).toHaveURL(/qa-created-1$/);
  expect(qa.writes).toHaveLength(1); expect(qa.writes[0].body.tank_type).toBe('breeder');
});

test('edit preserves device, measured readings, owner and type while updating planning data', async ({ page, qa }) => {
  Object.assign(qa.data.tanks[0], { tank_type: 'juvenile', length_cm: 100, width_cm: 100, height_cm: 60, normal_water_depth_cm: 40, crayfish_count: 5, shelter_count: 5, notes: 'Old notes' });
  const originalReadings = structuredClone(qa.data.sensor_readings);
  await page.goto('/admin/tanks/tank-a');
  await expect(page.getByText('Not Connected', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit Tank', exact: true }).click();
  await expect(page.getByLabel('Tank type *', { exact: true })).toBeDisabled();
  await expect(page.locator('[name="normalWaterDepthCm"]')).toHaveValue('40');
  await fill(page, { name: 'Renamed Tank', normalWaterDepthCm: '35' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL('/admin/tanks/tank-a');
  await expect(page.getByRole('heading', { name: 'Renamed Tank' })).toBeVisible();
  expect(qa.writes).toHaveLength(1); expect(qa.writes[0].method).toBe('PATCH');
  expect(qa.writes[0].body).not.toHaveProperty('user_id'); expect(qa.writes[0].body).not.toHaveProperty('tank_type');
  expect(qa.data.tanks[0].device_uid).toBe('device-a');
  expect(qa.data.sensor_readings).toEqual(originalReadings);
  await expect(page.locator('.modern-tank-detail-hero-card')).toContainText('Critical');
  await expect(page.locator('.tank-planning-guide .safety-status')).toHaveText('Normal');
});

test('existing column aliases and enum casing are preserved in writes', async ({ page, qa }) => {
  const schema = qa.tankSchema.definitions.tanks;
  schema.properties.tank_name = schema.properties.name; delete schema.properties.name;
  schema.required = schema.required.map(key => key === 'name' ? 'tank_name' : key);
  schema.properties.population = schema.properties.crayfish_count; delete schema.properties.crayfish_count;
  schema.properties.tank_type.enum = ['Juvenile', 'Breeder'];
  await open(page); await fill(page);
  await page.getByRole('button', { name: 'Create Tank' }).click();
  await expect(page).toHaveURL(/qa-created-1$/);
  expect(qa.writes[0].body).toMatchObject({ tank_name: values.name, tank_type: 'Juvenile', population: 5 });
  expect(qa.writes[0].body).not.toHaveProperty('name'); expect(qa.writes[0].body).not.toHaveProperty('crayfish_count');
});

test('missing schema blocks partial inserts and foreign-owned edit is unavailable', async ({ page, qa }) => {
  delete qa.tankSchema.definitions.tanks.properties.normal_water_depth_cm;
  await page.goto('/admin/tanks/add');
  await expect(page.getByRole('alert')).toContainText('Tank saving is not available');
  await expect(page.getByRole('button', { name: 'Create Tank' })).toBeDisabled();
  expect(qa.writes).toEqual([]);
  qa.tankSchema.definitions.tanks.properties.normal_water_depth_cm = { type: 'number' };
  qa.data.tanks[0].user_id = 'other-owner';
  await page.goto('/admin/tanks/tank-a/edit');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  expect(qa.writes).toEqual([]);
  expect(qa.reads.some(row => row.table === 'tanks' && row.filters.user_id === `eq.${user.id}` && row.filters.id === 'eq.tank-a')).toBe(true);
});

test('permission failure retains entries and permits a corrected retry', async ({ page, qa }) => {
  qa.tankWriteFailure = true;
  await open(page); await fill(page);
  await page.getByRole('button', { name: 'Create Tank' }).click();
  await expect(page.getByRole('alert')).toContainText('You do not have permission');
  await expect(page.locator('[name="name"]')).toHaveValue(values.name);
  await expect(page.getByRole('button', { name: 'Create Tank' })).toBeEnabled();
  qa.tankWriteFailure = false;
  await page.getByRole('button', { name: 'Create Tank' }).click();
  await expect(page).toHaveURL(/qa-created-2$/);
  expect(qa.writes).toHaveLength(2);
});

for (const width of [390, 768, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`Add Tank layout and guide: ${width}px ${theme}`, async ({ page, qa }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page); await fill(page);
      await page.getByRole('button', { name: theme === 'light' ? 'Light mode' : 'Dark mode', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator('.tank-planning-guide')).toContainText('5–15 advanced juveniles');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const field of await page.locator('.tank-form-field input, .tank-form-field select, .tank-form-field textarea').all()) {
        const box = await field.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      await page.screenshot({ path: `.security-add-tank-${width}-${theme}.png`, fullPage: true });
      expect(qa.writes).toEqual([]);
    });
  }
}
