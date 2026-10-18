import fs from 'node:fs/promises';
import { test, expect, user } from './fixtures.mjs';

const instant='2026-10-11T12:00:00Z';
const timestamp=/Oct 11, 2026,? 8:00\s*PM/;

for(const timezoneId of ['America/New_York','Asia/Tokyo','Europe/London']) {
 test.describe(timezoneId,()=>{
  test.use({timezoneId});
  test('same database reading, alerts, activity and orders show Philippine time',async({page,qa})=>{
   qa.serverTime=instant;
   qa.data.sensor_readings.forEach(row=>row.created_at=instant);
   qa.data.ammonia_readings.forEach(row=>row.created_at=instant);
   qa.data.marketplace_orders.forEach(row=>row.created_at=instant);
   qa.data.alerts=[{id:'time-alert',user_id:user.id,tank_id:'tank-a',title:'Timezone check',message:'Saved record',created_at:instant}];
   qa.data.control_logs=[{id:'time-log',user_id:user.id,tank_id:'tank-a',action_type:'threshold_updated',action_status:'updated',notes:'Timezone check',created_at:instant}];
   const raw=structuredClone(qa.data);
   await page.goto('/admin/readings');await expect(page.locator('body')).toContainText(timestamp);
   await page.goto('/admin/tanks/tank-a');await expect(page.locator('body')).toContainText(timestamp);
   await page.getByRole('button',{name:'Activity',exact:true}).click();await expect(page.locator('body')).toContainText(timestamp);
   await page.goto('/admin/alerts');await expect(page.locator('body')).toContainText(timestamp);
   await page.goto('/admin/orders');await expect(page.locator('body')).toContainText(timestamp);
   expect(qa.data).toEqual(raw);expect(qa.writes).toEqual([]);
  });
 });
}

test.describe('Manila date boundary in a New York browser',()=>{
 test.use({timezoneId:'America/New_York'});
 test('report queries and CSV include exactly the selected Philippine day',async({page,qa})=>{
  qa.serverTime=instant;
  const sample=qa.data.sensor_readings[0];
  qa.data.sensor_readings=[
   {id:'before',created_at:'2026-10-10T15:59:59.999Z',temperature_c:25.1},
   {id:'first',created_at:'2026-10-10T16:00:00Z',temperature_c:26.1},
   {id:'last',created_at:'2026-10-11T15:59:59.999Z',temperature_c:27.1},
   {id:'after',created_at:'2026-10-11T16:00:00Z',temperature_c:28.1},
  ].map(row=>({...sample,...row}));
  await page.goto('/admin/reports');await page.getByLabel('From Date',{exact:true}).fill('2026-10-11');
  await page.getByLabel('To Date',{exact:true}).fill('2026-10-11');
  await expect.poll(()=>qa.reads.some(read=>read.table==='sensor_readings' && read.query?.some(([key,value])=>key==='created_at'&&value==='gte.2026-10-10T16:00:00.000Z')
   && read.query?.some(([key,value])=>key==='created_at'&&value==='lt.2026-10-11T16:00:00.000Z'))).toBe(true);
  const exportButton=page.getByRole('button',{name:'Export CSV',exact:true});await expect(exportButton).toBeVisible();
  const pending=page.waitForEvent('download');await exportButton.click();const csv=await fs.readFile(await (await pending).path(),'utf8');
  expect(csv).toContain('26.1');expect(csv).toContain('27.1');expect(csv).not.toContain('25.1');expect(csv).not.toContain('28.1');
  expect(csv).toMatch(/Oct 11, 2026,? 12:00\s*AM/);expect(csv).toMatch(/Oct 11, 2026,? 11:59\s*PM/);
  const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Print Report',exact:true}).click();
  const popup=await popupPromise;await expect(popup.locator('.generated').first()).toContainText(timestamp);await popup.close();
 });
});

test('manual device clock changes do not move the server-anchored header or rewrite history',async({page,qa})=>{
 qa.serverTime=instant;qa.data.sensor_readings[0].created_at=instant;
 const raw=structuredClone(qa.data.sensor_readings);
 await page.goto('/admin/readings');const clock=page.locator('.modern-clock-card');
 await expect(clock).toContainText('Oct 11, 2026');await expect(clock).toContainText(/8:00:\d{2}\s*PM/);
 await page.clock.setFixedTime(new Date('1999-01-01T00:00:00Z'));
 await page.waitForTimeout(1100);await expect(clock).toContainText('Oct 11, 2026');await expect(clock).toContainText(/8:00:\d{2}\s*PM/);
 await page.clock.setFixedTime(new Date('2035-01-01T00:00:00Z'));
 await page.waitForTimeout(1100);await expect(clock).toContainText('Oct 11, 2026');await expect(clock).toContainText(/8:00:\d{2}\s*PM/);
 await expect(page.locator('body')).toContainText(timestamp);expect(qa.data.sensor_readings).toEqual(raw);
});

test('feeding day uses server Manila date; queued command omits client event timestamps',async({page,qa})=>{
 qa.serverTime=instant;
 qa.data.iot_devices=[{id:'actuator-a',tank_id:'tank-a',user_id:user.id,device_uid:'actuator-a',device_type:'actuator_hub',is_claimed:true,last_seen:instant}];
 await page.clock.setFixedTime(new Date('1999-01-01T00:00:00Z'));
 await page.goto('/admin/tanks/tank-a');
 await expect.poll(()=>qa.reads.some(read=>read.table==='device_commands' && read.query?.some(([key,value])=>key==='created_at'&&value==='gte.2026-10-10T16:00:00.000Z')
  && read.query?.some(([key,value])=>key==='created_at'&&value==='lt.2026-10-11T16:00:00.000Z'))).toBe(true);
 await page.getByRole('button',{name:'Controls',exact:true}).click();
 await page.getByRole('button',{name:/Feed Now/}).click();
 await page.getByRole('dialog',{name:'Feed crayfish?',exact:true}).getByRole('button',{name:'Feed Now',exact:true}).click();
 await expect.poll(()=>qa.writes.filter(write=>write.table==='device_commands'&&write.method==='POST').length).toBe(1);
 const body=qa.writes.find(write=>write.table==='device_commands'&&write.method==='POST').body;
 expect(body).not.toHaveProperty('created_at');expect(body).not.toHaveProperty('updated_at');expect(body).not.toHaveProperty('executed_at');
});

test('manual stuck-action reset uses a fresh database timestamp despite incorrect device clock',async({page,qa})=>{
 qa.serverTime=instant;
 qa.data.iot_devices=[{id:'actuator-a',tank_id:'tank-a',user_id:user.id,device_uid:'actuator-a',device_type:'actuator_hub',is_claimed:true,last_seen:instant}];
 qa.data.device_commands=[{id:'stuck',user_id:user.id,tank_id:'tank-a',device_uid:'actuator-a',command_type:'FEED_ONCE',command_status:'pending',created_at:instant}];
 await page.clock.setFixedTime(new Date('1999-01-01T00:00:00Z'));
 await page.goto('/admin/tanks/tank-a');await page.getByRole('button',{name:'Controls',exact:true}).click();
 await page.getByText('Advanced / Troubleshooting',{exact:true}).click();
 await page.getByRole('button',{name:'Reset Stuck Action',exact:true}).click();
 await expect.poll(()=>qa.writes.filter(write=>write.table==='device_commands'&&write.method==='PATCH').length).toBe(1);
 expect(qa.writes.find(write=>write.table==='device_commands'&&write.method==='PATCH').body.executed_at).toBe(instant);
});

test('changing the device clock cannot bypass the existing five-minute action wait',async({page,qa})=>{
 qa.serverTime=instant;
 qa.data.iot_devices=[{id:'actuator-a',tank_id:'tank-a',user_id:user.id,device_uid:'actuator-a',device_type:'actuator_hub',is_claimed:true,last_seen:instant}];
 qa.data.sensor_readings[0].created_at='2026-10-11T11:58:00Z';
 qa.data.device_commands=[{id:'recent-feed',user_id:user.id,tank_id:'tank-a',device_uid:'actuator-a',command_type:'FEED_ONCE',command_status:'done',
  executed_at:'2026-10-11T11:59:00Z',created_at:'2026-10-11T11:59:00Z'}];
 await page.goto('/admin/tanks/tank-a');await page.getByRole('button',{name:'Controls',exact:true}).click();
 const feed=page.getByRole('button',{name:/Feed Now/});await expect(feed).toBeDisabled();
 await expect(page.locator('.sensor-wait')).toContainText(/3:5\d|4:00/);
 await page.clock.setFixedTime(new Date('2035-01-01T00:00:00Z'));
 await page.waitForTimeout(1100);await expect(feed).toBeDisabled();
 await expect(page.locator('.sensor-wait')).toContainText(/3:5\d|4:00/);expect(qa.writes).toEqual([]);
});

test('unavailable server time keeps saved Manila timestamps and prevents a client-clock fallback',async({page,qa})=>{
 await page.route('**/rest/v1/rpc/craythrive_server_time',route=>route.fulfill({json:null}));
 qa.data.sensor_readings[0].created_at=instant;
 qa.data.iot_devices=[{id:'actuator-a',tank_id:'tank-a',user_id:user.id,device_uid:'actuator-a',device_type:'actuator_hub',is_claimed:true,last_seen:instant}];
 await page.goto('/admin/tanks/tank-a');await expect(page.locator('.modern-clock-card')).toContainText('Time unavailable');
 await expect(page.locator('body')).toContainText(timestamp);
 await page.getByRole('button',{name:'Controls',exact:true}).click();await page.getByRole('button',{name:/Feed Now/}).click();
 await expect(page.getByText('Server time is unavailable. Reconnect and retry.',{exact:true}).first()).toBeVisible();
 expect(qa.writes).toEqual([]);
});
