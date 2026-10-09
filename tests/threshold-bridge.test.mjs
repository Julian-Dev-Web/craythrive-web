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
 CREATE ROLE anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
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
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261010120000_threshold_compatibility_bridge.sql',import.meta.url),'utf8'));
const migrated=(await db.query('SELECT * FROM threshold_settings ORDER BY user_id')).rows;
beforeEach(async()=>{
 await db.exec("RESET ROLE; SELECT set_config('test.auth_uid','',false); TRUNCATE control_logs,tank_threshold_settings,threshold_settings,tanks,auth.users CASCADE;");
 await seedLegacy(); await asUser(owner);
});
async function asUser(id){await db.exec('RESET ROLE');await db.query("SELECT set_config('test.auth_uid',$1,false)",[id||'']);await db.exec('SET ROLE authenticated');}
async function apply(id,patch,scope='single_tank',source='manual'){
 return (await db.query('SELECT apply_tank_thresholds($1,$2,$3,$4) AS result',[id,patch,scope,source])).rows[0].result;
}
const bundle=async()=>(await db.query('SELECT get_tank_threshold_settings() AS rows')).rows[0].rows;
const logs=async()=>(await db.query("SELECT * FROM control_logs WHERE action_type='threshold_updated' ORDER BY tank_id")).rows;

test('bridge migration preserves the original legacy table and rows exactly without cloning',async()=>{
 assert.deepEqual(migrated,legacyBefore);
 assert.equal((await bundle()).length,1);assert.equal((await logs()).length,0);
 assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='threshold_settings' AND column_name='tank_id'")).rows.length,0);
});

test('old user-only upsert, singular read and update remain compatible after tank-specific Apply',async()=>{
 const before=(await db.query('SELECT * FROM threshold_settings WHERE user_id=$1',[owner])).rows;
 await apply(ids[0],{waterLevelMin:5});await apply(ids[1],{waterLevelMin:6});
 assert.deepEqual((await db.query('SELECT * FROM threshold_settings WHERE user_id=$1',[owner])).rows,before);
 await db.query('INSERT INTO threshold_settings(user_id,thresholds) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET thresholds=excluded.thresholds',[owner,{...defaults,waterLevelMin:4.8}]);
 assert.equal((await db.query('SELECT * FROM threshold_settings WHERE user_id=$1',[owner])).rows.length,1);
 assert.equal((await db.query('UPDATE threshold_settings SET water_level_min=4.8 WHERE user_id=$1 RETURNING id',[owner])).rows.length,1);
 const rows=await bundle();assert.equal(rows.find(row=>row.tank_id===ids[0]).thresholds.waterLevelMin,5);
 assert.equal(rows.find(row=>row.tank_id===ids[1]).thresholds.waterLevelMin,6);
 assert.equal(rows.find(row=>!row.tank_id).thresholds.waterLevelMin,4.8);
 assert.equal((await logs()).length,2);
});

test('single Apply creates only the selected override; other tanks keep fallback and no-op creates no activity',async()=>{
 const result=await apply(ids[0],{waterLevelMin:4.5});assert.equal(result.affected,1);assert.equal(result.changed,1);
 const rows=await bundle();assert.equal(rows.length,2);assert.equal(rows.filter(row=>row.tank_id).length,1);
 assert.equal(rows.find(row=>!row.tank_id).thresholds.waterLevelMin,4);assert.equal((await logs()).length,1);
 assert.equal((await apply(ids[0],{waterLevelMin:4.5})).changed,0);assert.equal((await logs()).length,1);
});

test('Apply All synchronizes every owned tank and the original legacy identity',async()=>{
 await db.query("UPDATE threshold_settings SET thresholds=thresholds||'{\"compatibility_note\":\"retain\"}' WHERE user_id=$1",[owner]);
 const legacy=(await bundle())[0];const result=await apply(ids[0],{waterLevelMin:5},'all_tanks');
 assert.equal(result.affected,3);assert.equal(result.changed,3);const rows=await bundle();assert.equal(rows.length,4);
 assert.ok(rows.every(row=>row.thresholds.waterLevelMin===5));assert.equal(rows.find(row=>!row.tank_id).id,legacy.id);
 assert.equal(rows.find(row=>!row.tank_id).thresholds.compatibility_note,'retain');
 assert.equal((await logs()).length,3);await asUser(other);assert.equal((await bundle()).length,1);
 assert.equal((await bundle())[0].thresholds.waterLevelMin,9);
});

test('ownership/RLS, row identity, grants and exact RPC parameters are enforced',async()=>{
 await assert.rejects(apply(foreign,{waterLevelMin:5}),/ownership/);
 await assert.rejects(db.query('INSERT INTO tank_threshold_settings(user_id,tank_id) VALUES($1,$2)',[owner,foreign]),/row-level security/);
 await asUser(other);await apply(foreign,{waterLevelMin:9.5});await asUser(owner);
 assert.equal((await db.query('SELECT * FROM tank_threshold_settings WHERE tank_id=$1',[foreign])).rows.length,0);
 assert.equal((await db.query('UPDATE tank_threshold_settings SET water_level_min=1 WHERE tank_id=$1 RETURNING id',[foreign])).rows.length,0);
 await apply(ids[0],{waterLevelMin:5});await assert.rejects(db.query('UPDATE tank_threshold_settings SET tank_id=$1 WHERE tank_id=$2',[ids[1],ids[0]]),/identity/);
 const signature=(await db.query("SELECT proargnames,pg_get_function_identity_arguments(oid) AS args,has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,has_function_privilege('anon',oid,'EXECUTE') AS anon FROM pg_proc WHERE proname='apply_tank_thresholds'")).rows[0];
 assert.deepEqual(signature.proargnames,['p_tank_id','p_patch','p_scope','p_source']);
 assert.equal(signature.args,'p_tank_id uuid, p_patch jsonb, p_scope text, p_source text');
 assert.equal(signature.authenticated,true);assert.equal(signature.anon,false);
 await asUser(null);await assert.rejects(apply(ids[0],{waterLevelMin:5}),/Authentication required/);
});

test('AI pending metadata does not apply a recommendation; acceptance changes only its tank',async()=>{
 await apply(ids[0],{waterLevelMin:4});assert.equal((await logs()).length,0);
 await db.query('UPDATE tank_threshold_settings SET pending_ai_suggestion=$1 WHERE tank_id=$2',[{parameter:'water_level',suggested_value:4.6},ids[0]]);
 assert.equal((await logs()).length,0);assert.equal((await bundle()).find(row=>row.tank_id===ids[0]).thresholds.waterLevelMin,4);
 await apply(ids[0],{waterLevelMin:19},'single_tank','ai_recommendation');
 const rows=await bundle();assert.equal(rows.find(row=>row.tank_id===ids[0]).thresholds.waterLevelMin,4.6);
 assert.equal(rows.find(row=>!row.tank_id).thresholds.waterLevelMin,4);assert.equal((await logs()).length,1);
});

test('legacy synchronization failure rolls back all tank writes and activity',async()=>{
 const before=await bundle();
 await db.exec("RESET ROLE; CREATE FUNCTION test_fail_legacy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'legacy failure'; END $$; CREATE TRIGGER test_fail_legacy BEFORE UPDATE ON threshold_settings FOR EACH ROW EXECUTE FUNCTION test_fail_legacy();");
 await asUser(owner);await assert.rejects(apply(ids[0],{waterLevelMin:5},'all_tanks'),/legacy failure/);
 assert.deepEqual(await bundle(),before);assert.equal((await logs()).length,0);
 await db.exec('RESET ROLE; DROP TRIGGER test_fail_legacy ON threshold_settings; DROP FUNCTION test_fail_legacy();');
});
