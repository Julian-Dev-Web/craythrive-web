import {test,expect,user} from './fixtures.mjs';
const instant='2026-10-19T02:00:00Z';
function setup(qa){qa.serverTime=instant;qa.data.iot_devices=[{id:'actuator-a',tank_id:'tank-a',user_id:user.id,device_uid:'actuator-a',device_type:'actuator_hub',is_claimed:true,last_seen:instant}];Object.assign(qa.data.sensor_readings[0],{created_at:instant,ph_value:7.2,water_depth_cm:5,water_status:'SAFE_IDEAL',temperature_status:'SAFE_IDEAL'});}
const normal=(id,type,status)=>({id,tank_id:'tank-a',user_id:user.id,device_uid:'actuator-a',command_type:type,command_value:'2',command_status:status,status:'pending',created_at:instant});
const feed=page=>page.locator('.modern-device-command-grid').getByRole('button',{name:/Feed Now|Feeding/});
const stop=page=>page.locator('.modern-device-command-grid').getByRole('button',{name:/Emergency Stop/});
const request=qa=>qa.data.device_commands.find(row=>row.command_type==='STOP_ALL');
async function open(page){await page.goto('/admin/tanks/tank-a');await page.getByRole('button',{name:'Controls',exact:true}).click();await expect(page.locator('[data-emergency-state]')).toHaveCount(0);}
async function tick(page){await page.clock.runFor(2000);}
function confirmStop(qa){Object.assign(request(qa),{command_status:'done',status:'pending',executed_at:instant,result_message:'Emergency stop applied. Pumps and feeder are stopped.'});}

test('already-fed rejection clears pending banner and polling without erasing readings or AI',async({page,qa})=>{
 setup(qa);qa.data.device_commands=[normal('feed','FEED_ONCE','pending')];await page.clock.install();await open(page);
 await expect(page.getByText('Action in progress',{exact:true})).toBeVisible();
 Object.assign(qa.data.device_commands[0],{command_status:'rejected',result_message:'FEED_ONCE rejected: tank was already fed today.'});await tick(page);
 await expect(page.locator('[data-feed-status="Rejected"]')).toContainText('Tank was already fed today.');
 await expect(page.getByText('Action in progress',{exact:true})).toHaveCount(0);await expect(feed(page)).toBeEnabled();
 const polls=qa.reads.filter(r=>r.table==='get_tank_actuator_control_state').length;await page.clock.runFor(6000);
 expect(qa.reads.filter(r=>r.table==='get_tank_actuator_control_state')).toHaveLength(polls);
 expect(qa.writes).toHaveLength(0);
});

test('Stop supersedes pending feed, queues once and stays latched after terminal acknowledgement and reload until explicit Resume',async({page,qa})=>{
 setup(qa);qa.data.device_commands=[normal('queued-feed','FEED_ONCE','pending')];await page.clock.install();await open(page);
 await expect(stop(page)).toBeEnabled();await stop(page).evaluate(b=>{b.click();b.click();});
 await expect.poll(()=>qa.data.device_commands.filter(r=>r.command_type==='STOP_ALL').length).toBe(1);
 await expect(feed(page)).toBeDisabled();expect(qa.data.device_commands[0].command_status).toBe('rejected');
 await expect(page.locator('[data-feed-status="Rejected"]')).toContainText('Cancelled because Emergency Stop');
 expect(request(qa).command_status).toBe('pending');await expect(page.locator('[data-emergency-state]')).toContainText('Waiting for actuator');
 const historyReads=qa.reads.filter(r=>['sensor_readings','ammonia_readings'].includes(r.table)).length;
 confirmStop(qa);await tick(page);await expect(page.getByText('Action in progress',{exact:true})).toHaveCount(0);await expect(feed(page)).toBeDisabled();
 expect(qa.reads.filter(r=>['sensor_readings','ammonia_readings'].includes(r.table))).toHaveLength(historyReads);
 await page.reload();await page.getByRole('button',{name:'Controls',exact:true}).click();await expect(feed(page)).toBeDisabled();
 await page.getByRole('button',{name:'Resume Controls',exact:true}).click();await expect.poll(()=>qa.data.device_commands.some(r=>r.command_type==='RESUME_CONTROLS')).toBe(true);
 const resume=qa.data.device_commands.find(r=>r.command_type==='RESUME_CONTROLS');Object.assign(resume,{command_status:'done',result_message:'Controls resumed. Outputs remain off until a new safe action.'});await tick(page);await expect(feed(page)).toBeEnabled();
 expect(qa.writes.every(w=>w.method!=='PATCH')).toBe(true);
});

for(const type of ['REFILL_FOR','DRAIN_FOR'])test(`${type} running can be stopped; only device acknowledgement terminates the simulated operation`,async({page,qa})=>{
 setup(qa);qa.data.device_commands=[normal('pump',type,'running')];await page.clock.install();await open(page);await stop(page).click();
 await expect.poll(()=>!!request(qa)).toBe(true);expect(qa.data.device_commands[0].command_status).toBe('running');
 confirmStop(qa);await tick(page);await expect(page.getByRole('button',{name:'Resume Controls',exact:true})).toBeDisabled();
 Object.assign(qa.data.device_commands[0],{command_status:'failed',result_message:'Interrupted by STOP_ALL.'});await tick(page);
 await expect(page.getByText('Action in progress',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Resume Controls',exact:true})).toBeEnabled();await expect(feed(page)).toBeDisabled();
});

test('offline stop times out to database failure without completion, releases spinner and keeps controls locked',async({page,qa})=>{
 setup(qa);await page.clock.install();await open(page);await stop(page).click();await expect.poll(()=>!!request(qa)).toBe(true);
 qa.serverTime='2026-10-19T02:02:01Z';await tick(page);await expect(page.locator('[data-emergency-state]')).toContainText('timed out');
 expect(request(qa).command_status).toBe('failed');expect(request(qa).executed_at).toBeUndefined();await expect(feed(page)).toBeDisabled();await expect(page.getByText('Action in progress',{exact:true})).toHaveCount(0);
 const count=qa.reads.filter(r=>r.table==='get_tank_actuator_control_state').length;await page.clock.runFor(6000);expect(qa.reads.filter(r=>r.table==='get_tank_actuator_control_state')).toHaveLength(count);
});

test('remote feed lock reset confirms, preserves all history and follows actual terminal status without feeding',async({page,qa})=>{
 setup(qa);qa.data.device_commands=[{...normal('old-feed','FEED_ONCE','done'),result_message:'FEED_ONCE completed.'}];await page.clock.install();await open(page);
 await page.getByText('Advanced / Troubleshooting',{exact:true}).click();const button=page.getByRole('button',{name:'Allow Another Feed Test Today',exact:true});
 page.once('dialog',d=>d.dismiss());await button.click();expect(qa.writes).toHaveLength(0);
 page.once('dialog',async d=>{expect(d.message()).toContain('clears only');await d.accept();});await button.click();
 await expect.poll(()=>qa.data.device_commands.some(r=>r.command_type==='RESET_FEED_LOCK')).toBe(true);
 const command=qa.data.device_commands.find(r=>r.command_type==='RESET_FEED_LOCK');expect(command).toMatchObject({duration_ms:0,status:'pending',command_status:'pending',command_source:'manual'});
 await expect(page.getByText('Resetting feed test lock...',{exact:true}).first()).toBeVisible();
 Object.assign(command,{command_status:'done',result_message:'Feed test lock reset. Normal feeding safety checks still apply.'});await tick(page);
 await expect(page.getByText('Feed test reset. You may use Feed Now again.',{exact:true})).toBeVisible();expect(qa.data.device_commands.find(r=>r.id==='old-feed').command_status).toBe('done');
 expect(qa.writes.filter(w=>w.method==='PATCH')).toHaveLength(0);expect(qa.writes.filter(w=>w.body.command_type==='FEED_ONCE')).toHaveLength(0);
});

test('missing emergency RPC locks normal controls but keeps Stop callable and shows a setup error',async({page,qa})=>{
 setup(qa);qa.controlRPCMissing=true;await page.goto('/admin/tanks/tank-a');await page.getByRole('button',{name:'Controls',exact:true}).click();
 await expect(page.locator('[data-emergency-state]')).toContainText('database migration');await expect(feed(page)).toBeDisabled();await expect(stop(page)).toBeEnabled();
});

test('Settings feeding-test button uses the paired command lifecycle and shows the actual failed reason without altering history',async({page,qa})=>{
 setup(qa);await page.clock.install();await page.goto('/admin/settings?tank=tank-a');
 const panel=page.getByRole('region',{name:'Feeding test maintenance'});await expect(panel.getByRole('button',{name:'Allow Another Feed Test Today',exact:true})).toBeEnabled();
 page.once('dialog',d=>d.accept());await panel.getByRole('button',{name:'Allow Another Feed Test Today',exact:true}).click();
 await expect.poll(()=>qa.data.device_commands.some(r=>r.command_type==='RESET_FEED_LOCK')).toBe(true);
 const command=qa.data.device_commands.find(r=>r.command_type==='RESET_FEED_LOCK');Object.assign(command,{command_status:'failed',result_message:'NVS reset failed on actuator.'});await tick(page);
 await expect(panel).toContainText('NVS reset failed on actuator.');await expect(panel.getByRole('button',{name:'Allow Another Feed Test Today',exact:true})).toBeEnabled();
 expect(qa.writes).toHaveLength(1);expect(qa.writes[0].body).toMatchObject({command_type:'RESET_FEED_LOCK',device_uid:'actuator-a',user_id:user.id,tank_id:'tank-a'});
});

test('Stop remains callable during an in-flight normal insert and an older response cannot restore pending controls',async({page,qa})=>{
 setup(qa);await page.clock.install();await open(page);let release;const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/rest/v1/device_commands*',async route=>{if(route.request().method()==='POST')await gate;await route.fallback();});
 try{
  await feed(page).click();await page.getByRole('dialog').getByRole('button',{name:'Feed Now',exact:true}).click();await expect(feed(page)).toBeDisabled();await expect(stop(page)).toBeEnabled();
  await stop(page).click();await expect.poll(()=>!!request(qa)).toBe(true);release();
  await expect(page.locator('[data-emergency-state]')).toContainText('Waiting for actuator');await expect(feed(page)).toBeDisabled();expect(qa.data.device_commands.filter(r=>r.command_type==='FEED_ONCE')).toHaveLength(0);
  confirmStop(qa);await tick(page);await expect(feed(page)).toBeDisabled();await expect(page.getByText('Action in progress',{exact:true})).toHaveCount(0);
 }finally{release();}
});
