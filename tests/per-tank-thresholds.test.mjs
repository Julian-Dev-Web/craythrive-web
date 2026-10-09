import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
after(() => db.close());
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const foreign = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const defaults = { temperatureMin:20, temperatureMax:30, phMin:6.5, phMax:8.5, turbidityMax:2.5, waterLevelMin:4, ammoniaMax:0.25 };
await db.exec(`CREATE SCHEMA auth;
 CREATE ROLE authenticated;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid',true),'')::uuid $$;
 CREATE TABLE tanks(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),tank_name text);
 CREATE TABLE threshold_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
  thresholds jsonb NOT NULL DEFAULT '{}',temperature_min numeric NOT NULL DEFAULT 20,temperature_max numeric NOT NULL DEFAULT 30,
  ph_min numeric NOT NULL DEFAULT 6.5,ph_max numeric NOT NULL DEFAULT 8.5,turbidity_max numeric NOT NULL DEFAULT 40,
  water_level_min numeric NOT NULL DEFAULT 35,ammonia_max numeric NOT NULL DEFAULT 0.25,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT threshold_settings_user_id_key UNIQUE(user_id));
 CREATE TABLE control_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
  tank_id uuid NOT NULL REFERENCES tanks(id),device_id uuid,action_type text NOT NULL,action_status text DEFAULT 'completed',notes text,created_at timestamptz DEFAULT now());
 ALTER TABLE threshold_settings ENABLE ROW LEVEL SECURITY;
 ALTER TABLE tanks ENABLE ROW LEVEL SECURITY;
 ALTER TABLE control_logs ENABLE ROW LEVEL SECURITY;
 CREATE POLICY owner_threshold ON threshold_settings FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
 CREATE POLICY owner_tanks ON tanks FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
 -- Reflect the inspected existing permissive log policies; new restrictions
 -- must still isolate configuration activity without changing actuator logs.
 CREATE POLICY broad_logs ON control_logs FOR ALL TO authenticated USING(true) WITH CHECK(true);
 GRANT USAGE ON SCHEMA public,auth TO authenticated;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
`);
async function seedLegacy() {
 await db.query('INSERT INTO auth.users VALUES ($1),($2)',[owner,other]);
 for (const [id, user, name] of [...ids.map((id,i)=>[id,owner,`Tank ${i+1}`]),[foreign,other,'Other tank']]) {
  await db.query('INSERT INTO tanks VALUES($1,$2,$3)',[id,user,name]);
 }
 await db.query('INSERT INTO threshold_settings(user_id,thresholds,water_level_min) VALUES($1,$2,35),($3,$4,35)',[owner,defaults,other,{...defaults,waterLevelMin:9}]);
}
await seedLegacy();
const legacyBefore = (await db.query('SELECT * FROM threshold_settings ORDER BY user_id')).rows;
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261009180000_per_tank_thresholds.sql',import.meta.url),'utf8'));
const migrated = (await db.query('SELECT * FROM threshold_settings ORDER BY user_id,tank_id NULLS FIRST')).rows;
const migrationLogs = (await db.query('SELECT * FROM control_logs')).rows;
beforeEach(async()=>{
 await db.exec("RESET ROLE; SELECT set_config('test.auth_uid','',false); TRUNCATE control_logs,threshold_settings,tanks,auth.users CASCADE;");
 await seedLegacy();
 await db.exec(`INSERT INTO threshold_settings(user_id,tank_id,thresholds,temperature_min,temperature_max,ph_min,ph_max,turbidity_max,water_level_min,ammonia_max)
 SELECT s.user_id,t.id,s.thresholds,s.temperature_min,s.temperature_max,s.ph_min,s.ph_max,s.turbidity_max,s.water_level_min,s.ammonia_max FROM threshold_settings s JOIN tanks t ON t.user_id=s.user_id WHERE s.tank_id IS NULL;`);
 await db.exec('TRUNCATE control_logs');
 await asUser(owner);
});
async function asUser(id) { await db.exec('RESET ROLE'); await db.query("SELECT set_config('test.auth_uid',$1,false)",[id||'']); await db.exec('SET ROLE authenticated'); }
async function apply(id,patch,scope='single_tank',source='manual') {
 return (await db.query('SELECT apply_tank_thresholds($1,$2,$3,$4) AS result',[id,patch,scope,source])).rows[0].result;
}
const logs = async()=> (await db.query("SELECT * FROM control_logs WHERE action_type='threshold_updated' ORDER BY tank_id")).rows;
const values = async()=> (await db.query('SELECT tank_id,thresholds FROM threshold_settings WHERE tank_id IS NOT NULL ORDER BY tank_id')).rows;

test('migration preserves both complete legacy rows and copies settings to every owned tank without activity',()=>{
 assert.deepEqual(migrated.filter(row=>row.tank_id===null).map(({tank_id,pending_ai_suggestion,pending_ai_suggested_at,...row})=>{
  assert.equal(tank_id,null);assert.equal(pending_ai_suggestion,null);assert.equal(pending_ai_suggested_at,null);return row;
 }),legacyBefore);
 assert.equal(migrated.filter(row=>row.tank_id).length,4);
 for(const row of migrated.filter(row=>row.tank_id&&row.user_id===owner)) assert.deepEqual(row.thresholds,defaults);
 assert.equal(migrationLogs.length,0);
});
test('single tank patch preserves other fields and tanks, one audit event, no-op produces no extra event',async()=>{
 assert.equal((await apply(ids[1],{waterLevelMin:4.5})).changed,1);
 const rows=await values(); assert.deepEqual(rows.map(row=>row.thresholds.waterLevelMin),[4,4.5,4]);
 assert.equal(rows[1].thresholds.phMin,6.5);
 const activity=await logs();assert.equal(activity.length,1);assert.equal(activity[0].tank_id,ids[1]);
 assert.equal(activity[0].action_status,'updated');assert.equal(activity[0].metadata.source,'manual');
 assert.equal(activity[0].metadata.actor_user_id,owner);assert.equal(activity[0].metadata.old_values.waterLevelMin,4);
 assert.match(activity[0].notes,/Water Level Minimum: 4 cm → 4.5 cm/);
 assert.equal((await apply(ids[1],{waterLevelMin:4.5})).changed,0);assert.equal((await logs()).length,1);
});
test('apply-all copies selected config to owned tanks only and logs once per changed tank',async()=>{
 await apply(ids[1],{phMin:7});await db.exec('RESET ROLE; TRUNCATE control_logs');await asUser(owner);
 const result=await apply(ids[1],{waterLevelMin:4.5},'all_tanks');assert.equal(result.affected,3);assert.equal(result.changed,3);
 for(const row of await values()) {assert.equal(row.thresholds.waterLevelMin,4.5);assert.equal(row.thresholds.phMin,7);}
 const activity=await logs();assert.equal(activity.length,3);assert.ok(activity.every(row=>row.metadata.scope==='all_tanks'));
 await asUser(other);assert.equal((await values())[0].thresholds.waterLevelMin,9);assert.equal((await logs()).length,0);
});
test('AI recommendation alone changes nothing; explicit Apply uses current server recommendation and user actor',async()=>{
 await db.query('UPDATE threshold_settings SET pending_ai_suggestion=$1 WHERE tank_id=$2',[{parameter:'water_level',suggested_value:4.5,reason:'Review'},ids[0]]);
 assert.equal((await logs()).length,0);assert.equal((await values())[0].thresholds.waterLevelMin,4);
 await apply(ids[0],{waterLevelMin:19},'single_tank','ai_recommendation');
 const activity=await logs();assert.equal(activity.length,1);assert.equal(activity[0].metadata.source,'ai_recommendation');
 assert.equal(activity[0].metadata.actor_user_id,owner);assert.match(activity[0].notes,/AI recommendation accepted by user/);
 assert.equal((await values())[0].thresholds.waterLevelMin,4.5);
 const row=(await db.query('SELECT pending_ai_suggestion FROM threshold_settings WHERE tank_id=$1',[ids[0]])).rows[0];assert.equal(row.pending_ai_suggestion,null);
});
test('RLS blocks another owner, forged ownership, legacy writes and forged audit rows',async()=>{
 assert.equal((await db.query('SELECT * FROM threshold_settings WHERE tank_id=$1',[foreign])).rows.length,0);
 await assert.rejects(apply(foreign,{waterLevelMin:4.5}),/ownership/);
 await assert.rejects(db.query('INSERT INTO threshold_settings(user_id,tank_id) VALUES($1,$2)',[owner,foreign]),/row-level security/);
 assert.equal((await db.query("UPDATE threshold_settings SET water_level_min=1 WHERE tank_id IS NULL RETURNING id")).rows.length,0);
 await assert.rejects(db.query("INSERT INTO control_logs(user_id,tank_id,action_type) VALUES($1,$2,'threshold_updated')",[owner,ids[0]]),/row-level security/);
 await apply(ids[0],{waterLevelMin:4.5});await asUser(other);assert.equal((await logs()).length,0);
});
test('duplicate rows rejected and apply-all failure rolls back settings and activity together',async()=>{
 await assert.rejects(db.query('INSERT INTO threshold_settings(user_id,tank_id) VALUES($1,$2)',[owner,ids[0]]),/unique constraint/);
 const before=await values();
 await db.exec(`RESET ROLE; CREATE FUNCTION test_reject_target() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tank_id='${ids[1]}' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER test_reject BEFORE UPDATE ON threshold_settings FOR EACH ROW EXECUTE FUNCTION test_reject_target();`);
 await asUser(owner);await assert.rejects(apply(ids[0],{waterLevelMin:4.5},'all_tanks'),/simulated failure/);
 assert.deepEqual(await values(),before);assert.equal((await logs()).length,0);
 await db.exec('RESET ROLE; DROP TRIGGER test_reject ON threshold_settings; DROP FUNCTION test_reject_target()');
});
test('new tank inherits legacy settings, first no-op creates no misleading audit; invalid values rejected',async()=>{
 const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';await db.query('INSERT INTO tanks VALUES($1,$2,$3)',[id,owner,'New tank']);
 await apply(id,{waterLevelMin:4});assert.equal((await logs()).length,0);
 await assert.rejects(apply(id,{waterLevelMin:null}),/Invalid threshold value/);
 await assert.rejects(apply(id,{phMin:10,phMax:8}),/supported limits/);
 await assert.rejects(apply(id,{waterLevelMin:4.5},null),/Invalid threshold operation/);
});

test('one-tank owner gets one update and activity; untouched fields retain a concurrent saved change',async()=>{
 await db.query('DELETE FROM tanks WHERE id IN ($1,$2)',[ids[1],ids[2]]);
 await db.query("UPDATE threshold_settings SET thresholds=thresholds||'{\"phMin\":7}' WHERE tank_id=$1",[ids[0]]);
 await db.exec('RESET ROLE; TRUNCATE control_logs');await asUser(owner);
 const result=await apply(ids[0],{waterLevelMin:4.5});assert.equal(result.affected,1);assert.equal(result.changed,1);
 assert.equal((await values())[0].thresholds.phMin,7);assert.equal((await logs()).length,1);
});

test('AI apply-all is explicitly attributed per changed tank and no-op acceptances do not create events',async()=>{
 await db.query('UPDATE threshold_settings SET pending_ai_suggestion=$1 WHERE tank_id=$2',[{parameter:'water_level',suggested_value:4.5},ids[0]]);
 const result=await apply(ids[0],{},'all_tanks','ai_recommendation');assert.equal(result.changed,3);
 assert.ok((await logs()).every(row=>row.metadata.source==='ai_recommendation'&&row.metadata.scope==='all_tanks'&&row.metadata.actor_user_id===owner));
 await db.query('UPDATE threshold_settings SET pending_ai_suggestion=$1 WHERE tank_id=$2',[{parameter:'water_level',suggested_value:4.5},ids[0]]);
 assert.equal((await apply(ids[0],{},'single_tank','ai_recommendation')).changed,0);assert.equal((await logs()).length,3);
});
