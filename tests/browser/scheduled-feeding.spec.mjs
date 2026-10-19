import {test,expect,user} from './fixtures.mjs';
const timestamp='2026-10-19T03:45:00Z';
test('device-generated scheduled record remains one Activity entry with correct source, cycles and Manila time across reopen',async({page,qa})=>{
 qa.serverTime=timestamp;
 qa.data.device_commands=[{id:'scheduled-feed',user_id:user.id,tank_id:'tank-a',device_uid:'actuator-a',command_type:'FEED_ONCE',command_value:'2',command_source:'schedule',command_status:'done',status:'pending',created_at:'2026-10-19T03:44:00Z',executed_at:timestamp,result_message:'Servo sequence completed.'}];
 qa.data.alerts=[{id:'scheduled-alert',user_id:user.id,tank_id:'tank-a',command_id:'scheduled-feed',type:'actuator_command',title:'Automatic Feeding Completed',message:'Tank A ran its automatic feeder with 2 dispense cycles.',source:'device_commands',severity:'normal',created_at:timestamp,metadata:{command_type:'FEED_ONCE',command_source:'schedule',command_status:'done'}}];
 for(let i=0;i<2;i++){
  await page.goto('/admin/tanks/tank-a');await page.getByRole('button',{name:'Activity',exact:true}).click();
  const entry=page.locator('[data-activity-id="device_commands:scheduled-feed"]');await expect(entry).toHaveCount(1);await expect(entry).toContainText('Automatic Feeding');await expect(entry).toContainText('Dispense cycles: 2');await expect(entry).toContainText('Automatic schedule');await expect(entry).toContainText('11:45');await expect(page.locator('[data-activity-id="alerts:scheduled-alert"]')).toHaveCount(0);
 }
 expect(qa.writes).toHaveLength(0);expect(qa.data.alerts).toHaveLength(1);
 await page.goto('/admin/alerts');await expect(page.getByText('Automatic Feeding Completed',{exact:true}).first()).toBeVisible();expect(qa.writes).toHaveLength(0);
});
