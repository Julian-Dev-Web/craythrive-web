import test from 'node:test';import assert from 'node:assert/strict';
import {isCommandActive,isCommandTerminal,commandResultReason} from '../supabase/functions/_shared/actuatorCommandLifecycle.js';
test('command_status wins over legacy pending; only active states block controls and terminal states never spin',()=>{
 for(const status of ['pending','running','processing'])assert.equal(isCommandActive({command_status:status,status:'done'}),true);
 for(const status of ['done','completed','rejected','failed','cancelled','canceled']){const row={command_status:status,status:'pending'};assert.equal(isCommandActive(row),false);assert.equal(isCommandTerminal(row),true);}
 assert.equal(isCommandActive(null),false);assert.equal(isCommandActive({command_status:'unknown',status:'pending'}),false);
 assert.equal(commandResultReason({result_message:'FEED_ONCE rejected: tank was already fed today.'}),'Tank was already fed today.');
});
