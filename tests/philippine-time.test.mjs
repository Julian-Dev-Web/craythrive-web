import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyPhilippineDateFilter, compareTimestamps, formatPhilippineCalendarDate, formatPhilippineDateTime,
  formatPhilippineRelativeTime, formatPhilippineTime, isWithinPhilippineDateRange, philippineDateKey,
  philippineDayBounds, timestampMs } from '../supabase/functions/_shared/philippineTime.js';
import { createServerClock } from '../supabase/functions/_shared/serverClock.js';

test('12:00 UTC is 8 PM Manila, equal explicit offsets identify the same instant',()=>{
  assert.match(formatPhilippineTime('2026-10-11T12:00:00Z'),/8:00\s*PM/i);
  assert.equal(formatPhilippineDateTime('2026-10-11T12:00:00Z'),formatPhilippineDateTime('2026-10-11T08:00:00-04:00'));
  assert.equal(timestampMs('2026-10-11 12:00:00+00'),timestampMs('2026-10-11T20:00:00+08:00'));
  assert.equal(philippineDateKey('2026-10-10T16:00:00Z'),'2026-10-11');
});

test('Web and portable Expo module format identically in New York, Tokyo and London device zones',()=>{
  const script=`import {formatPhilippineDateTime} from './src/utils/philippineTime.js';
    console.log(formatPhilippineDateTime('2026-10-11T12:00:00Z'));`;
  const results=['America/New_York','Asia/Tokyo','Europe/London'].map(TZ=>execFileSync(process.execPath,
    ['--experimental-specifier-resolution=node','--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TZ}}).trim());
  assert.ok(results.every(result=>result===formatPhilippineDateTime('2026-10-11T12:00:00Z')));
});

test('Manila calendar date uses inclusive start/exclusive next midnight, including submillisecond last second',()=>{
  const bounds=philippineDayBounds('2026-10-11');
  assert.deepEqual(bounds,{startIso:'2026-10-10T16:00:00.000Z',endIso:'2026-10-11T16:00:00.000Z'});
  for(const value of ['2026-10-10T16:00:00Z','2026-10-11T15:59:59.999999Z']) assert.equal(isWithinPhilippineDateRange(value,'2026-10-11','2026-10-11'),true);
  for(const value of ['2026-10-10T15:59:59.999Z','2026-10-11T16:00:00Z']) assert.equal(isWithinPhilippineDateRange(value,'2026-10-11','2026-10-11'),false);
  assert.match(formatPhilippineCalendarDate('2026-10-11'),/Oct 11, 2026/);
  assert.throws(()=>philippineDayBounds('2026-02-30'),RangeError);
  assert.equal(philippineDayBounds('2028-02-29').endIso,'2028-02-29T16:00:00.000Z');
});

test('query filter preserves query/owner scope and uses gte/lt, with open-ended dates supported',()=>{
  const calls=[],query={gte(...args){calls.push(['gte',...args]);return this;},lt(...args){calls.push(['lt',...args]);return this;}};
  assert.equal(applyPhilippineDateFilter(query,'2026-10-11','2026-10-11'),query);
  assert.deepEqual(calls,[['gte','created_at','2026-10-10T16:00:00.000Z'],['lt','created_at','2026-10-11T16:00:00.000Z']]);
  assert.equal(isWithinPhilippineDateRange('2026-10-11T16:00:00Z','2026-10-11',''),true);
  assert.equal(isWithinPhilippineDateRange('2026-10-10T15:59:59Z','','2026-10-11'),true);
});

test('ambiguous timestamps are not silently interpreted in the device zone; chronological sort uses instants',()=>{
  for(const value of [null,'bad','2026-10-11','2026-10-11T12:00:00','2026-02-30T12:00:00Z']) assert.equal(Number.isNaN(timestampMs(value)),true);
  assert.equal(formatPhilippineDateTime('2026-10-11T12:00:00'),'No date');
  const rows=['2026-10-11T13:00:00+08:00','2026-10-11T06:00:00Z','invalid'];
  assert.deepEqual(rows.sort((a,b)=>compareTimestamps(b,a)),['2026-10-11T06:00:00Z','2026-10-11T13:00:00+08:00','invalid']);
});

test('server anchor uses monotonic elapsed time; expiry, invalid responses, and clear never fall back to wall clock',()=>{
  let tick=100;const clock=createServerClock({monotonicNow:()=>tick,maxAgeMs:60000});
  assert.equal(clock.now(),null);clock.set('2026-10-11T12:00:00Z');
  const before=Date.now;Date.now=()=>0;
  try {tick+=1234;assert.equal(clock.now(),timestampMs('2026-10-11T12:00:01.234Z'));}
  finally{Date.now=before;}
  tick+=60000;assert.equal(clock.now(),null);
  assert.throws(()=>clock.set('2026-10-11T12:00:00'),/Invalid/);
  clock.set('2026-10-11T12:00:00Z');clock.clear();assert.equal(clock.now(),null);
  assert.equal(formatPhilippineRelativeTime('2026-10-11T12:00:00Z',null),formatPhilippineDateTime('2026-10-11T12:00:00Z'));
  assert.equal(formatPhilippineRelativeTime('2026-10-11T12:00:00Z',timestampMs('2026-10-11T12:10:00Z')),'10m ago');
});

test('read-only server-time migration has restricted grants and database defaults ignore a client clock',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE authenticated; CREATE ROLE anon; CREATE TABLE events(id integer,created_at timestamptz DEFAULT now());');
    await db.exec(await fs.readFile(new URL('../supabase/migrations/20261011150000_server_time.sql',import.meta.url),'utf8'));
    const grants=(await db.query("SELECT has_function_privilege('authenticated','craythrive_server_time()','EXECUTE') AS allowed,has_function_privilege('anon','craythrive_server_time()','EXECUTE') AS anonymous")).rows[0];
    assert.deepEqual(grants,{allowed:true,anonymous:false});
    const row=(await db.query('INSERT INTO events(id) VALUES(1) RETURNING created_at,craythrive_server_time() AS server_time')).rows[0];
    assert.ok(Math.abs(timestampMs(row.created_at)-timestampMs(row.server_time))<10000);
    assert.equal((await db.query('SELECT count(*) AS n FROM events')).rows[0].n,1);
  } finally {await db.close();}
});
