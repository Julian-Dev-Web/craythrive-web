import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPumpAction, formatPumpAlert, getActualRefillDurationMs } from '../supabase/functions/_shared/pumpActionWording.js';

test('manual and automatic successful drain never display requested or actual durations',()=>{
 for(const action of ['DRAIN_FOR','AUTO_DRAIN','drain_water']) {
  const row={action_type:action,action_status:'done',duration_ms:10000,duration_seconds:10,
   requested_seconds:10,actual_duration_ms:250,run_seconds:1,pulse_ms:250,
   result_message:'DRAIN safety micro-pulse completed for 250 ms.'};
  const original=structuredClone(row);const result=formatPumpAction(row);
  assert.equal(result.title,'Drain completed');assert.equal(result.message,'The drain pump was activated.');
  assert.deepEqual(row,original);assert.doesNotMatch(result.message,/second|\d|flow/i);
 }
});

test('explicit failed/rejected/pending execution cannot become completed from old title or result text',()=>{
 for(const [status,title,message] of [
  ['failed','Drain failed','The drain action could not be completed.'],
  ['rejected','Drain rejected','The drain action was blocked by a safety rule.'],
  ['pending','Drain pending','The drain action is pending.'],
 ]) {
  const row={title:'Drain completed',message:'The drain pump ran for 10 seconds.',status:'active',
   metadata:{command_type:'DRAIN_FOR',command_status:status}};
  assert.deepEqual(formatPumpAlert(row),{title,message});assert.equal(row.status,'active');
 }
 assert.equal(formatPumpAction({command_type:'DRAIN_FOR',command_status:'failed',result_message:'could not be completed'}).status,'failed');
});

test('refill uses actual duration with correct singular, plural and meaningful millisecond precision',()=>{
 for(const [actual,message] of [[1000,'1 second'],[2000,'2 seconds'],[250,'0.25 seconds'],[0.25,'0.25 milliseconds']]) {
  const row={command_type:'REFILL_FOR',command_status:'done',duration_ms:10000,metadata:{actual_duration_ms:actual}};
  const result=formatPumpAction(row);assert.equal(result.title,'Add Water completed');
  assert.equal(result.message,`The refill pump ran for ${message}.`);
 }
 assert.equal(formatPumpAction({action_type:'AUTO_REFILL',action_status:'done',metadata:{actual_duration_seconds:2}}).message,'The refill pump ran for 2 seconds.');
});

test('firmware refill acknowledgement wins over requested duration; old alert duration is not treated as measured',()=>{
 const row={command_type:'REFILL_FOR',command_status:'done',duration_ms:10000,
  result_message:'REFILL relay command completed for 1000 ms. Physical pump flow is not electronically sensed.'};
 assert.equal(getActualRefillDurationMs(row),1000);
 assert.equal(formatPumpAction(row).message,'The refill pump ran for 1 second.');
 assert.equal(formatPumpAction({...row,actual_duration_ms:2000}).message,'The refill pump ran for 2 seconds.');
 for(const actual of [null,'',false,-1,Infinity,'not known']) {
  const unknown={title:'Refill completed',message:'The refill pump ran for 10 seconds.',
   metadata:{duration_ms:10000,duration_seconds:10,requested_seconds:10,run_seconds:10,pulse_ms:1000,actual_duration_ms:actual}};
  assert.equal(formatPumpAlert(unknown).message,'The refill pump was activated.');
 }
});

test('presentation does not mutate raw metadata, alert lifecycle, non-pump events or AI recommendations',()=>{
 const row={title:'Drain completed',message:'The drain pump ran for 10 seconds.',status:'resolved',is_read:true,
  metadata:{command_type:'DRAIN_FOR',command_status:'done',duration_ms:10000}};
 const before=structuredClone(row);assert.deepEqual(formatPumpAlert(row),{title:'Drain completed',message:'The drain pump was activated.'});
 assert.deepEqual(row,before);
 for(const untouched of [{title:'Add water needed',message:'AI recommends adding water.'},
  {title:'Water level critical',message:'Do not drain this tank.'},{command_type:'FEED_ONCE',command_status:'done'}]) {
  assert.equal(formatPumpAction(untouched),null);
 }
 assert.equal(formatPumpAction(null),null);
});
