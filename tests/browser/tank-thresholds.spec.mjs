import { test, expect, user } from './fixtures.mjs';

const openSettings = async page => { await page.goto('/admin/settings'); await expect(page.getByLabel('Tank', { exact: true })).toBeVisible(); };
const water = page => page.getByLabel('Minimum Water Level value');
const save = page => page.getByRole('button', { name: 'Apply to This Tank', exact: true }).first();
const entries = qa => qa.data.control_logs.filter(row => row.action_type === 'threshold_updated');
function perTank(qa) {
  const baseline = qa.data.threshold_settings[0].thresholds;
  qa.data.tank_threshold_settings.push(...qa.data.tanks.map((tank,index) => ({ id: `setting-${tank.id}`, tank_id: tank.id, user_id: user.id,
    thresholds: { ...baseline, waterLevelMin: 4 + index } })));
}

test('single-tank Apply preserves other tanks, records one activity, refresh and selector persist values',async({page,qa})=>{
 perTank(qa);await openSettings(page);await page.getByLabel('Tank',{exact:true}).selectOption('tank-b');await expect(water(page)).toHaveValue('5');
 await water(page).fill('5.5');await save(page).click();await expect(page.getByText('Threshold settings updated for Tank B.',{exact:true})).toBeVisible();
 expect(qa.data.tank_threshold_settings.map(row=>row.thresholds.waterLevelMin)).toEqual([4,5.5,6]);
 expect(qa.data.threshold_settings.find(row=>!row.tank_id).thresholds.waterLevelMin).toBe(4.5);
 expect(entries(qa)).toHaveLength(1);expect(entries(qa)[0].tank_id).toBe('tank-b');
 await page.reload();await expect(water(page)).toHaveValue('5.5');
 await page.getByLabel('Tank',{exact:true}).selectOption('tank-a');await expect(water(page)).toHaveValue('4');
 await page.goto('/admin/tanks/tank-b');await page.getByRole('button',{name:'Activity',exact:true}).click();
 await expect(page.getByText('Threshold Updated',{exact:true})).toBeVisible();await expect(page.getByText('Updated',{exact:true})).toBeVisible();
 await expect(page.getByText('Water Level Minimum: 5 cm → 5.5 cm.')).toBeVisible();
 expect(qa.writes.filter(row=>row.table==='device_commands')).toEqual([]);
});

test('Apply All requires confirmation, updates only owned tanks and creates one event per affected tank',async({page,qa})=>{
 perTank(qa);qa.data.tanks.push({id:'foreign',user_id:'someone-else',name:'Other farmer tank'});
 await openSettings(page);await expect(page.getByLabel('Tank',{exact:true}).locator('option')).toHaveCount(3);
 await water(page).fill('4.8');await page.getByRole('button',{name:'Apply to All My Tanks',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('all 3 tanks');expect(qa.writes).toEqual([]);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(qa.writes).toEqual([]);
 await page.getByRole('button',{name:'Apply to All My Tanks',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm Apply to All Tanks',exact:true}).click();
 await expect(page.getByText('Threshold settings updated for 3 tanks.',{exact:true})).toBeVisible();
 expect(entries(qa)).toHaveLength(3);expect(entries(qa).every(row=>row.metadata.scope==='all_tanks')).toBe(true);
 expect(qa.data.tank_threshold_settings.map(row=>row.thresholds.waterLevelMin)).toEqual([4.8,4.8,4.8]);
 expect(qa.data.threshold_settings.find(row=>!row.tank_id).thresholds.waterLevelMin).toBe(4.8);
 expect(qa.data.tank_threshold_settings.some(row=>row.tank_id==='foreign')).toBe(false);
});

test('AI remains pending until explicit acceptance, and activity identifies acceptance by the user',async({page,qa})=>{
 perTank(qa);qa.data.tank_threshold_settings[0].pending_ai_suggestion={parameter:'water_level',suggested_value:4.8,reason:'Check the configured operating minimum.'};
 await openSettings(page);await expect(page.getByText('AI threshold recommendation',{exact:true})).toBeVisible();expect(qa.writes).toEqual([]);expect(entries(qa)).toEqual([]);
 await page.getByRole('button',{name:'Apply Recommendation to This Tank',exact:true}).click();
 await expect(water(page)).toHaveValue('4.8');expect(entries(qa)).toHaveLength(1);expect(entries(qa)[0].metadata.source).toBe('ai_recommendation');
 await page.goto('/admin/tanks/tank-a');await page.getByRole('button',{name:'Activity',exact:true}).click();
 await expect(page.getByText('AI recommendation accepted by user',{exact:true})).toBeVisible();
});

test('no-op Apply creates no activity; missing migration does not activate browser-only changes',async({page,qa})=>{
 perTank(qa);await openSettings(page);await save(page).click();await expect(page.getByText('No threshold values changed. No activity was recorded.')).toBeVisible();expect(qa.writes).toEqual([]);
 qa.thresholdWriteFailure=true;await water(page).fill('5.5');await save(page).click();
 await expect(page.getByText('Tank threshold setup requires the database migration. Your changes have not been applied.')).toBeVisible();
 expect(qa.errors).toEqual([expect.stringContaining('404')]);qa.errors.length=0;
 expect(entries(qa)).toEqual([]);await page.reload();await expect(water(page)).toHaveValue('4');
});

test('same-tab and cross-tab saves immediately re-evaluate unchanged readings using the correct tank',async({page,context,qa})=>{
 perTank(qa);qa.data.sensor_readings.forEach(row=>{row.ph_value=7.2;row.water_depth_cm=5;row.water_status='SAFE_IDEAL';});
 qa.data.ammonia_readings.forEach(row=>{row.ammonia=0.1;});
 const raw=structuredClone(qa.data.sensor_readings);
 await page.goto('/admin/tanks/tank-b');
 const level=page.locator('.modern-tank-detail-metric').filter({has:page.getByText('Water Level',{exact:true})});
 await expect(level).toContainText('Normal');
 const settings=await context.newPage();await openSettings(settings);await settings.getByLabel('Tank',{exact:true}).selectOption('tank-b');
 await water(settings).fill('5.5');await save(settings).click();await expect(water(settings)).toHaveValue('5.5');
 await expect(level).toContainText('Warning');await expect(level).toContainText('below the active tank minimum');
 expect(qa.data.sensor_readings).toEqual(raw);
 await page.goto('/admin/tanks/tank-a');await expect(page.locator('.modern-tank-detail-metric').filter({has:page.getByText('Water Level',{exact:true})})).toContainText('Normal');
 await settings.close();
});

test('tank threshold editor and confirmation fit a phone viewport',async({page,qa})=>{
 perTank(qa);await page.setViewportSize({width:390,height:844});await openSettings(page);
 await page.getByLabel('Tank',{exact:true}).selectOption('tank-c');await page.getByRole('button',{name:'Apply to All My Tanks',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
});
