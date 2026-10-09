import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THRESHOLDS, fetchEffectiveTankThresholds, fetchTankThresholdRows, normalizeThresholds,
  resolveTankThresholds, thresholdBundle } from '../supabase/functions/_shared/thresholdResolution.js';
import { applyTankThresholdSettings, applyPendingTankRecommendation } from '../docs/mobile-next-apk/thresholdSettings.js';

// Exercise the same portable reader intended for the next Expo build and AI.
function mockClient(responses) {
  const calls=[];
  return { calls, async rpc() { return { error: { code: 'PGRST202' } }; }, from(table) {
    const filters=[];const call={table,filters};calls.push(call);
    return {
      select() { return this; },
      eq(key,value) { filters.push(['eq',key,value]);return this; },
      then(resolve,reject) { assert.ok(responses.length,'unexpected database read');return Promise.resolve(responses.shift()).then(resolve,reject); },
      async maybeSingle() { assert.ok(responses.length,'unexpected database read');return responses.shift(); },
    };
  } };
}
const row=(tank_id,waterLevelMin)=>({user_id:'owner',tank_id,thresholds:{waterLevelMin}});

test('bridge reader resolves owned overrides and legacy rows through the authenticated read RPC',async()=>{
  const rows=[row(null,4),row('tank-a',5),{...row('tank-b',19),user_id:'other'}];
  const client={async rpc(name) {assert.equal(name,'get_tank_threshold_settings');return {data:rows};}};
  assert.equal((await fetchEffectiveTankThresholds(client,'owner','tank-a')).waterLevelMin,5);
  assert.equal((await fetchEffectiveTankThresholds(client,'owner','tank-b')).waterLevelMin,4);
  const denied={code:'42501'};
  await assert.rejects(fetchEffectiveTankThresholds({async rpc(){return {error:denied};}},'owner','tank-a'),error=>error===denied);
  await assert.rejects(fetchEffectiveTankThresholds({async rpc(){return {data:{}};}},'owner','tank-a'),/Invalid tank threshold/);
});

test('portable normalization preserves JSON precedence, zeros, and numeric strings without mutating rows',()=>{
  const input={water_level_min:35,thresholds:{waterLevelMin:'4',ammoniaMax:0,phMin:false}};
  const before=JSON.stringify(input);const result=normalizeThresholds(input);
  assert.equal(result.waterLevelMin,4);assert.equal(result.ammoniaMax,0);
  assert.equal(result.phMin,DEFAULT_THRESHOLDS.phMin);assert.equal(JSON.stringify(input),before);
});

test('Web bundle, next-mobile reader and AI reader resolve tank -> legacy -> defaults identically',async()=>{
  const rows=[row(null,4),row('tank-a',5)];const bundle=thresholdBundle(rows);
  const a=mockClient([{data:[rows[1]]},{data:rows[0]}]);
  assert.deepEqual(await fetchEffectiveTankThresholds(a,'owner','tank-a'),resolveTankThresholds(bundle,'tank-a'));
  assert.equal(a.calls[0].table,'tank_threshold_settings');
  assert.deepEqual(a.calls[0].filters,[['eq','user_id','owner']]);
  const b=mockClient([{data:[]},{data:rows[0]}]);
  assert.deepEqual(await fetchEffectiveTankThresholds(b,'owner','tank-b'),resolveTankThresholds(bundle,'tank-b'));
  assert.equal(b.calls[1].table,'threshold_settings');
  assert.deepEqual(b.calls[1].filters,[['eq','user_id','owner']]);
  const c=mockClient([{data:[]},{data:null}]);
  assert.deepEqual(await fetchEffectiveTankThresholds(c,'owner','tank-c'),DEFAULT_THRESHOLDS);
});

test('pre-bridge reader handles only a genuinely missing override table, preserving the old account row',async()=>{
  for(const code of ['42P01','PGRST205']) {
    const client=mockClient([{error:{code,message:'relation public.tank_threshold_settings does not exist'}},{data:row(null,4)}]);
    assert.equal((await fetchEffectiveTankThresholds(client,'owner','tank-a')).waterLevelMin,4);
    assert.deepEqual(client.calls[1].filters,[['eq','user_id','owner']]);
  }
});

test('reader rejects missing tank, authorization errors, duplicate rows and network errors without guessing',async()=>{
  const client=mockClient([]);
  await assert.rejects(fetchEffectiveTankThresholds(client,'owner',null),/selected tank/);
  assert.equal(client.calls.length,0);
  for(const error of [{code:'42501',message:'permission denied'}, {code:'PGRST116',message:'multiple rows'},
    {code:'42703',message:'column something_else does not exist'}, {message:'network error'}]) {
    const denied=mockClient([{error}]);
    await assert.rejects(fetchEffectiveTankThresholds(denied,'owner','tank-a'),value=>value===error);
    assert.equal(denied.calls.length,1);
  }
  const legacyError={code:'42501',message:'permission denied'};
  await assert.rejects(fetchEffectiveTankThresholds(mockClient([{data:[]},{error:legacyError}]),'owner','tank-a'),value=>value===legacyError);
});

test('shared collection fallback keeps overrides even when legacy changes later, with no legacy tank_id query',async()=>{
  const canonical=row('tank-a',3.5),legacy=row(null,4.5);
  const client=mockClient([{data:[canonical,{...row('tank-b',19),user_id:'other'}]},{data:legacy}]);
  const rows=await fetchTankThresholdRows(client,'owner');
  assert.deepEqual(rows,[legacy,canonical]);
  assert.equal(resolveTankThresholds(thresholdBundle(rows),'tank-a').waterLevelMin,3.5);
  assert.equal(resolveTankThresholds(thresholdBundle(rows),'tank-b').waterLevelMin,4.5);
  assert.ok(client.calls.every(call=>call.filters.every(([,key])=>key!=='tank_id')));
  const missingWrongTable=mockClient([{error:{code:'42P01',message:'relation public.other_table does not exist'}}]);
  await assert.rejects(fetchTankThresholdRows(missingWrongTable,'owner'),error=>error.code==='42P01');
  await assert.rejects(fetchTankThresholdRows(mockClient([{data:{}},{data:legacy}]),'owner'),/Invalid tank threshold response/);
});

test('prepared mobile Apply adapter requires tank context and never falls back to a user-only write',async()=>{
  const calls=[];
  const client={async rpc(name,args) {calls.push({name,args});return {data:{affected:1}};}};
  await assert.rejects(applyPendingTankRecommendation(client,null),/Tank context/);
  await assert.rejects(applyTankThresholdSettings(client,null,{waterLevelMin:5}),/Select a tank/);
  assert.equal(calls.length,0);
  await applyTankThresholdSettings(client,'tank-a',{waterLevelMin:5});
  assert.equal(calls[0].args.p_tank_id,'tank-a');assert.equal(calls[0].args.p_source,'manual');
  await applyPendingTankRecommendation(client,'tank-a');
  assert.deepEqual(calls[1].args,{p_tank_id:'tank-a',p_patch:{},p_scope:'single_tank',p_source:'ai_recommendation'});
  const missingRpc={code:'PGRST202',message:'missing migration'};
  await assert.rejects(applyTankThresholdSettings({async rpc(){return {error:missingRpc};}},'tank-a',{}),error=>error===missingRpc);
});
