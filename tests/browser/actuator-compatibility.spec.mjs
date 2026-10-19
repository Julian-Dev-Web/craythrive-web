import { test, expect, user } from './fixtures.mjs';

const instant = '2026-10-19T02:00:00Z';
function setup(qa) {
  qa.serverTime = instant; qa.commandSourceMissing = true;
  qa.data.iot_devices = [{ id: 'actuator-a', tank_id: 'tank-a', user_id: user.id,
    device_uid: 'actuator-a', device_type: 'actuator_hub', is_claimed: true, last_seen: instant }];
  const reading = { ...qa.data.sensor_readings[0], created_at: instant, ph_value: 7.2,
    water_depth_cm: 5, water_status: 'SAFE_IDEAL', temperature_status: 'SAFE_IDEAL' };
  qa.data.sensor_readings = [0, 1, 2].map(index => ({ ...reading, id: `fresh-${index}`,
    created_at: new Date(new Date(instant).getTime() - index * 1000).toISOString() }));
}
const writes = qa => qa.writes.filter(row => row.table === 'device_commands' && row.method === 'POST');
const controls = page => page.locator('.modern-device-command-grid');
async function open(page) {
  await page.goto('/admin/tanks/tank-a');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
}
async function feed(page) {
  await controls(page).getByRole('button', { name: /Feed Now/ }).click();
  await page.getByRole('dialog', { name: 'Feed crayfish?', exact: true }).getByRole('button', { name: 'Feed Now', exact: true }).click();
}
for (const [type, label] of [['FEED_ONCE', 'Feed Now'], ['REFILL_FOR', 'Add Water'], ['DRAIN_FOR', 'Drain Water']]) {
  test(`production legacy schema: ${label} queues once while retaining the current safety gates`, async ({ page, qa }) => {
    setup(qa); await open(page);
    if (type === 'FEED_ONCE') await feed(page);
    else {
      const button = controls(page).getByRole('button', { name: new RegExp(label) });
      await expect(button).toBeEnabled(); await button.click();
    }
    await expect.poll(() => writes(qa).length).toBe(1);
    expect(writes(qa)[0].body).toMatchObject({ command_type: type, command_status: 'pending', status: 'pending',
      user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a' });
    expect(writes(qa)[0].body).not.toHaveProperty('command_source');
    await expect(controls(page).getByRole('button', { name: /Add Water/ })).toBeDisabled();
    await expect(controls(page).getByRole('button', { name: /Drain Water/ })).toBeDisabled();
    if (type === 'FEED_ONCE') await expect(page.locator('[data-feed-status="Pending Verification"]')).toContainText('Feeding request sent');
    expect(qa.data.device_commands).toHaveLength(1);
  });
}
test('legacy schema Settings reset submits one maintenance request, preserves earlier successful feed and does not dispense', async ({ page, qa }) => {
  setup(qa);
  const earlier = { id: 'real-completed-feed', user_id: user.id, tank_id: 'tank-a', device_uid: 'actuator-a',
    command_type: 'FEED_ONCE', command_status: 'done', status: 'pending', command_value: '2', created_at: instant };
  qa.data.device_commands = [earlier];
  await page.goto('/admin/settings?tank=tank-a');
  const panel = page.getByRole('region', { name: 'Feeding test maintenance' });
  const button = panel.getByRole('button', { name: 'Allow Another Feed Test Today', exact: true });
  await expect(button).toBeEnabled(); page.once('dialog', dialog => dialog.accept()); await button.click();
  await expect.poll(() => writes(qa).length).toBe(1);
  expect(writes(qa)[0].body).toMatchObject({ command_type: 'RESET_FEED_LOCK', duration_ms: 0, command_status: 'pending' });
  expect(writes(qa)[0].body).not.toHaveProperty('command_source');
  expect(qa.data.device_commands.find(row => row.id === earlier.id)).toEqual(earlier);
  expect(writes(qa).some(row => row.body.command_type === 'FEED_ONCE')).toBe(false);
  await expect(panel.getByRole('button', { name: 'Resetting feed test lock...', exact: true })).toBeDisabled();
});
test('missing optional source never unlocks an emergency latch', async ({ page, qa }) => {
  setup(qa); qa.data.tank_automation_settings = [{ tank_id: 'tank-a', user_id: user.id, emergency_stop_active: true }];
  await open(page);
  for (const name of [/Feed Now/, /Add Water/, /Drain Water/]) await expect(controls(page).getByRole('button', { name })).toBeDisabled();
  await expect(page.locator('[data-emergency-state]')).toBeVisible(); expect(writes(qa)).toHaveLength(0);
  expect(qa.reads.some(row => row.table === 'device_commands' && row.filters.select === 'command_source')).toBe(false);
});
test('missing optional source never bypasses unstable-water pump protection', async ({ page, qa }) => {
  setup(qa); qa.data.sensor_readings[1].water_depth_cm = 7;
  await open(page);
  for (const name of [/Add Water/, /Drain Water/]) await expect(controls(page).getByRole('button', { name })).toBeDisabled();
  expect(writes(qa)).toHaveLength(0);
});
test('after database metadata is installed the next request uses it without reloading the page', async ({ page, qa }) => {
  setup(qa); await page.clock.install(); await open(page); await feed(page);
  await expect.poll(() => writes(qa).length).toBe(1);
  expect(writes(qa)[0].body).not.toHaveProperty('command_source');
  Object.assign(qa.data.device_commands[0], { command_status: 'rejected', result_message: 'Daily lock rejected the request.' });
  await page.clock.runFor(2000);
  await expect(page.locator('[data-feed-status="Rejected"]')).toBeVisible();
  qa.commandSourceMissing = false; await feed(page);
  await expect.poll(() => writes(qa).length).toBe(2);
  expect(writes(qa)[1].body.command_source).toBe('manual');
});
