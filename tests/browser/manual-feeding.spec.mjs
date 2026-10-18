import { test, expect, user } from './fixtures.mjs';

const instant = '2026-10-17T02:00:00Z';
function setup(qa) {
  qa.serverTime = instant;
  qa.data.iot_devices = [{ id: 'actuator-a', tank_id: 'tank-a', user_id: user.id, device_uid: 'actuator-a', device_type: 'actuator_hub', is_claimed: true, last_seen: instant }];
  Object.assign(qa.data.sensor_readings[0], { created_at: instant, ph_value: 7.2, water_depth_cm: 5, water_status: 'SAFE_IDEAL', temperature_status: 'SAFE_IDEAL' });
}
const manualChoices = page => page.locator('.manual-feed-options').filter({ has: page.locator('dialog.manual-feed-confirm') });
const feedWrites = qa => qa.writes.filter(write => write.table === 'device_commands' && write.method === 'POST');
const feedButton = page => page.locator('.modern-device-command-grid').getByRole('button', { name: /Feed Now|Feeding/ });
async function open(page) {
  await page.goto('/admin/tanks/tank-a');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
}
async function confirm(page) {
  await feedButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Feed crayfish?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Feed Now', exact: true }).click();
}

for (const cycles of [1, 2, 3]) test(`${cycles} dispense cycles are confirmed and queued to the paired actuator`, async ({ page, qa }) => {
  setup(qa);
  await open(page);
  await expect(manualChoices(page).getByRole('radio', { name: /2 Cycles/ })).toBeChecked();
  await manualChoices(page).getByRole('radio', { name: new RegExp(`${cycles} Cycle`) }).check();
  await feedButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Feed crayfish?', exact: true });
  await expect(dialog).toContainText(`${cycles} dispense ${cycles === 1 ? 'cycle' : 'cycles'}`);
  expect(feedWrites(qa)).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Feed Now', exact: true }).click();
  await expect.poll(() => feedWrites(qa).length).toBe(1);
  expect(feedWrites(qa)[0].body).toMatchObject({ command_type: 'FEED_ONCE', command_value: cycles, duration_ms: 0,
    command_status: 'pending', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a' });
  expect(feedWrites(qa)[0].body).not.toHaveProperty('created_at');
  await expect(page.locator('[data-feed-status="Requested"]')).toContainText('Feeding request sent');
  await expect(page.locator('[data-feed-status="Requested"]')).not.toContainText('Feeding completed');
  await expect(feedButton(page)).toBeDisabled();
  await expect(manualChoices(page).getByRole('radio', { name: new RegExp(`${cycles} Cycle`) })).toBeChecked();
  await expect(manualChoices(page).getByRole('radio', { name: new RegExp(`${cycles} Cycle`) })).toBeDisabled();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.locator('[data-activity-id^="device_commands:"]')).toContainText(`Dispense cycles: ${cycles}`);
});

test('cancel and Escape do not queue a command and leave the selection intact', async ({ page, qa }) => {
  setup(qa); await open(page);
  await manualChoices(page).getByRole('radio', { name: /3 Cycles/ }).check();
  await feedButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await feedButton(page).click(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(manualChoices(page).getByRole('radio', { name: /3 Cycles/ })).toBeChecked();
  expect(feedWrites(qa)).toHaveLength(0);
});

for (const status of ['done', 'rejected', 'failed']) test(`polling reports ${status} truthfully after a pending request`, async ({ page, qa }) => {
  setup(qa); await page.clock.install(); await open(page); await confirm(page);
  await expect.poll(() => feedWrites(qa).length).toBe(1);
  await expect(feedButton(page)).toBeDisabled();
  const command = qa.data.device_commands.at(-1);
  Object.assign(command, { command_status: 'running', created_at: instant });
  await page.clock.runFor(2000);
  await expect(page.locator('[data-feed-status="Started"]')).toBeVisible();
  Object.assign(command, { command_status: status, executed_at: instant,
    result_message: status === 'done' ? 'FEED_ONCE completed.' : status === 'rejected' ? 'Unsafe pH: feeding rejected.' : 'Servo command failed.' });
  await page.clock.runFor(2000);
  const outcome = { done: 'Completed', rejected: 'Rejected', failed: 'Failed' }[status];
  const card = page.locator(`[data-feed-status="${outcome}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(status === 'done' ? 'Feeding completed — 2 dispense cycles' : status === 'rejected' ? 'blocked by a safety rule' : 'could not be completed');
  if (status !== 'done') {
    await expect(feedButton(page)).toBeEnabled();
    await expect(page.getByText(/This tank was already fed today/)).toHaveCount(0);
  }
  else await expect(page.getByText(/This tank was already fed today/).first()).toBeVisible();
  expect(feedWrites(qa)).toHaveLength(1);
});

test('a done row without a firmware acknowledgement stays unconfirmed and does not count as fed today', async ({ page, qa }) => {
  setup(qa);
  qa.data.device_commands = [{ id: 'unconfirmed', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a',
    command_type: 'FEED_ONCE', command_value: '3', command_status: 'done', created_at: '2026-10-17T01:00:00Z' }];
  await open(page);
  await expect(page.locator('[data-feed-status="Unknown / Unconfirmed"]')).toContainText('Execution has not been confirmed');
  await expect(page.getByText(/This tank was already fed today/)).toHaveCount(0);
  await expect(feedButton(page)).toBeEnabled();
});

test('double confirmation cannot insert duplicates while a request is in flight', async ({ page, qa }) => {
  setup(qa); await open(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/rest/v1/device_commands*', async route => {
    if (route.request().method() === 'POST') await gate;
    await route.fallback();
  });
  try {
    await feedButton(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Feed Now', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(feedButton(page)).toBeDisabled();
    release();
    await expect.poll(() => feedWrites(qa).length).toBe(1);
    await expect(page.locator('[data-feed-status="Requested"]')).toBeVisible();
    qa.activityReadFailure = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).last().click();
    await page.waitForLoadState('networkidle');
    await expect(feedButton(page)).toBeDisabled();
    await expect(page.locator('[data-feed-status="Requested"]')).toBeVisible();
    expect(feedWrites(qa)).toHaveLength(1);
  } finally { release(); }
});

test('an acknowledged feed today retains the existing explicit daily warning and cancellation', async ({ page, qa }) => {
  setup(qa);
  qa.data.device_commands = [{ id: 'completed-today', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a',
    command_type: 'FEED_ONCE', command_value: 2, command_status: 'done', created_at: '2026-10-17T01:00:00Z',
    executed_at: '2026-10-17T01:00:00Z', result_message: 'FEED_ONCE completed.' }];
  await open(page);
  await expect(page.getByText(/This tank was already fed today/).first()).toBeVisible();
  await feedButton(page).click();
  let warned = false;
  page.once('dialog', async dialog => { warned = /already fed today/.test(dialog.message()); await dialog.dismiss(); });
  await page.getByRole('dialog', { name: 'Feed crayfish?', exact: true }).getByRole('button', { name: 'Feed Now', exact: true }).click();
  await expect(page.getByText('Feeding cancelled.', { exact: true })).toBeVisible();
  expect(warned).toBe(true);
  expect(feedWrites(qa)).toHaveLength(0);
});

test('unverified command/history reads prevent a feed insert instead of treating missing data as permission', async ({ page, qa }) => {
  setup(qa); await open(page);
  await feedButton(page).click();
  qa.activityReadFailure = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Feed Now', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The feeding request could not be verified or sent');
  expect(feedWrites(qa)).toHaveLength(0);
});

test('existing pending feeds lock the selected requested amount after page reload', async ({ page, qa }) => {
  setup(qa);
  qa.data.device_commands = [{ id: 'pending', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a',
    command_type: 'FEED_ONCE', command_value: '3', command_status: 'pending', created_at: instant }];
  await open(page);
  await expect(feedButton(page)).toBeDisabled();
  await expect(manualChoices(page).getByRole('radio', { name: /3 Cycles/ })).toBeChecked();
  await expect(page.locator('[data-feed-status="Requested"]')).toContainText('3 dispense cycles requested');
  expect(feedWrites(qa)).toHaveLength(0);
});

test('sensor hubs and actuators paired to another tank cannot receive manual feed', async ({ page, qa }) => {
  setup(qa);
  qa.data.iot_devices[0].tank_id = 'tank-b';
  qa.data.iot_devices.push({ ...qa.data.iot_devices[0], id: 'sensor', device_uid: 'sensor-a', tank_id: 'tank-a', device_type: 'sensor_hub' });
  await open(page);
  await expect(feedButton(page)).toBeDisabled();
  await expect(page.getByText('Actuator device is not connected to this tank.', { exact: true })).toBeVisible();
  expect(feedWrites(qa)).toHaveLength(0);
});

test('confirmation rechecks pairing and pending commands before insertion', async ({ page, qa }) => {
  setup(qa); await open(page); await feedButton(page).click();
  qa.data.iot_devices[0].tank_id = 'tank-b';
  await page.getByRole('dialog').getByRole('button', { name: 'Feed Now', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Actuator device is not connected');
  expect(feedWrites(qa)).toHaveLength(0);
  qa.data.iot_devices[0].tank_id = 'tank-a';
  await feedButton(page).click();
  qa.data.device_commands.push({ id: 'other-action', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a', command_type: 'REFILL_FOR', command_status: 'running', created_at: instant });
  await page.getByRole('dialog').getByRole('button', { name: 'Feed Now', exact: true }).click();
  await expect(page.getByText('Another action is still running. Please wait for it to finish.', { exact: true })).toBeVisible();
  expect(feedWrites(qa)).toHaveLength(0);
});

test('feed options and confirmation fit narrow, tablet and desktop layouts', async ({ page, qa }) => {
  setup(qa);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await open(page);
    await expect(page.getByText('Check that the feeder contains enough feed before dispensing.', { exact: true }).first()).toBeVisible();
    await feedButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Feed crayfish?', exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  expect(feedWrites(qa)).toHaveLength(0);
});
