import { test, expect, user } from './fixtures.mjs';
import fs from 'node:fs/promises';

const successfulDrain='The drain pump was activated.';
for(const [name,type,status,result,title,message,value] of [
 ['manual drain','DRAIN_FOR','done','DRAIN_FOR completed for 250 ms. Safety check passed.','Drain completed',successfulDrain,'on'],
 ['automatic drain','DRAIN_FOR','done','Automatic water assist: Relay pulse executed.','Drain – Pending Verification','The automatic action result has not been verified.','auto'],
 ['rejected drain','DRAIN_FOR','rejected','Drain rejected: hardware safety lock is ON.','Drain rejected','The drain action was blocked by a safety rule.','on'],
 ['failed drain','DRAIN_FOR','failed','Drain could not be completed.','Drain failed','The drain action could not be completed.','on'],
 ['one second refill','REFILL_FOR','done','REFILL_FOR completed for 1000 ms. Safety check passed.','Add Water completed','The refill pump ran for 1 second.','on'],
 ['two second refill','REFILL_FOR','done','REFILL_FOR completed for 2000 ms. Safety check passed.','Add Water completed','The refill pump ran for 2 seconds.','on'],
 ['automatic refill unknown runtime','REFILL_FOR','done','Automatic water assist: Relay pulse executed.','Add Water – Pending Verification','The automatic action result has not been verified.','auto'],
]) {
 test(`${name}: Latest Action and activity use accurate wording and retain status/metadata`,async({page,qa})=>{
  const row={id:'pump-action',tank_id:'tank-a',user_id:user.id,command_type:type,command_status:status,status,
    command_value:value,duration_ms:10000,result_message:result,created_at:new Date().toISOString(),executed_at:new Date().toISOString()};
  qa.data.device_commands=[row];const raw=structuredClone(row);
  await page.goto('/admin/tanks/tank-a');
  const latest=page.locator('.modern-tank-detail-panel').filter({has:page.getByRole('heading',{name:'Recent tank control',exact:true})});
  await expect(latest).toContainText(title);await expect(latest).toContainText(message);
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  const activity=page.locator('[data-activity-id="device_commands:pump-action"]');
  const outcome=value==='auto'?'Pending Verification':status==='done'?'Completed':status==='rejected'?'Skipped':'Failed';
  await expect(activity).toContainText(message);await expect(activity.locator('.tank-activity-outcome')).toHaveText(outcome);
  await expect(activity).not.toContainText('10 seconds');await expect(activity).not.toContainText('250 ms');
  expect(qa.data.device_commands[0]).toEqual(raw);expect(qa.writes).toEqual([]);
 });
}

test('Alerts, bell and Tank Details format historical pump records without rewriting history',async({page,qa})=>{
 const now=new Date().toISOString();
 qa.data.alerts=[
  {id:'old-drain',user_id:user.id,tank_id:'tank-a',title:'Drain completed',message:'The drain pump ran for 10 seconds.',status:'active',created_at:now},
  {id:'old-refill',user_id:user.id,tank_id:'tank-a',title:'Refill completed',message:'The refill pump ran for 10 seconds.',status:'active',created_at:now,
   metadata:{command_type:'REFILL_FOR',command_status:'done',duration_ms:10000,actual_duration_ms:1000}},
  {id:'auto-drain',user_id:user.id,tank_id:'tank-a',title:'Pump action recorded',message:'Automatic drain for 10 seconds.',status:'active',created_at:now,
   metadata:{action_type:'AUTO_DRAIN',action_status:'done',duration_seconds:10}},
 ];
 const raw=structuredClone(qa.data.alerts);
 await page.goto('/admin/alerts');await expect(page.getByText(successfulDrain,{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Add Water completed',{exact:true})).toBeVisible();
 await expect(page.getByText('The refill pump ran for 1 second.',{exact:true})).toBeVisible();
 await expect(page.getByText(/pump ran for 10 seconds/)).toHaveCount(0);
 await page.getByRole('button',{name:'Notifications',exact:true}).click();
 const bell=page.locator('.modern-notification-panel');await expect(bell).toContainText(successfulDrain);
 await expect(bell).toContainText('The refill pump ran for 1 second.');await expect(bell).not.toContainText('10 seconds');
 await page.goto('/admin/tanks/tank-a');await page.getByRole('button',{name:'Alerts',exact:true}).click();
 await expect(page.locator('.modern-tank-detail-list-row').filter({hasText:'Drain completed'}).first()).toContainText(successfulDrain);
 await expect(page.locator('.modern-tank-detail-list-row').filter({hasText:'Add Water completed'})).toContainText('The refill pump ran for 1 second.');
 expect(qa.data.alerts).toEqual(raw);expect(qa.writes).toEqual([]);
});

test('dashboard retains pump history while report CSV/print excludes alert records',async({page,qa})=>{
 const created_at=new Date().toISOString();
 qa.data.alerts=[
  {id:'drain-history',user_id:user.id,tank_id:'tank-a',title:'Drain completed',message:'The drain pump ran for 10 seconds.',status:'active',created_at},
  {id:'refill-history',user_id:user.id,tank_id:'tank-a',title:'Refill completed',message:'The refill pump ran for 10 seconds.',status:'active',created_at,
   metadata:{command_type:'REFILL_FOR',command_status:'done',actual_duration_ms:2000,duration_ms:10000}},
 ];
 await page.goto('/admin');
 await page.getByText('Recent history',{exact:true}).click();
 const history=page.locator('details').filter({hasText:'Recent history'});
 await expect(history).toContainText('Add Water completed');
 await page.goto('/admin/reports');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
 const csv=await fs.readFile(await (await pending).path(),'utf8');
 expect(csv).not.toContain(successfulDrain);expect(csv).not.toContain('The refill pump ran for 2 seconds.');expect(csv).not.toContain('pump ran for 10 seconds');
 const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Print Report',exact:true}).click();
 const popup=await popupPromise;await expect(popup.locator('body')).toContainText('Water Readings');
 await expect(popup.locator('body')).not.toContainText(successfulDrain);
 await expect(popup.locator('body')).not.toContainText('The refill pump ran for 2 seconds.');
 await expect(popup.locator('body')).not.toContainText('pump ran for 10 seconds');await popup.close();
 expect(qa.writes).toEqual([]);
});
