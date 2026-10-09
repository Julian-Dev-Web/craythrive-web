// Real UI/REST checks in an isolated browser. Credentials, session state,
// cookies, headers, traces and screenshots are never exported or logged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { normalizeThresholds, resolveTankThresholds, thresholdBundle } from '../supabase/functions/_shared/thresholdResolution.js';

const origin = 'http://127.0.0.1:4182';
const project = 'abtzkqfrwzcocyrwcrfc';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const labels = { temperatureMin: 'Minimum Temperature', temperatureMax: 'Maximum Temperature',
  phMin: 'Minimum pH', phMax: 'Maximum pH', turbidityMax: 'Water Clarity Minimum',
  waterLevelMin: 'Minimum Water Level', ammoniaMax: 'Maximum Ammonia' };
const browser = await chromium.launch({ headless: false,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
let page;
let stage = 'manual_sign_in';
let temporaryChange = null;
const startedAt = Date.now();
const report = { project, authenticated: false };

async function snapshot() {
  return page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.js');
    const { fetchThresholdRows } = await import('/src/services/tankThresholdService.js');
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data?.user) throw new Error('Verified user required.');
    const uid = auth.data.user.id;
    const [tanks, legacy, rows, logs] = await Promise.all([
      supabase.from('tanks').select('id').eq('user_id', uid).order('created_at'),
      supabase.from('threshold_settings').select('*').eq('user_id', uid).maybeSingle(),
      fetchThresholdRows(supabase, uid),
      supabase.from('control_logs').select('*').eq('user_id', uid).eq('action_type', 'threshold_updated').order('created_at').limit(1000),
    ]);
    if (tanks.error || legacy.error || logs.error) throw new Error('Authenticated snapshot failed.');
    return { tanks: tanks.data, legacy: legacy.data, rows, logs: logs.data,
      actorAttribution: logs.data.every(log => log.metadata?.actor_user_id === uid) };
  });
}

async function applyUi(scope) {
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.hostname === `${project}.supabase.co`
      && url.pathname === '/rest/v1/rpc/apply_tank_thresholds'
      && response.request().method() === 'POST';
  }, { timeout: 30000 });
  responsePromise.catch(() => {});
  if (scope === 'single_tank') await page.getByRole('button', { name: 'Apply to This Tank', exact: true }).first().click();
  else {
    await page.getByRole('button', { name: 'Apply to All My Tanks', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm Apply to All Tanks', exact: true }).click();
  }
  const response = await responsePromise;
  assert.equal(response.status(), 200, 'Remote Apply did not return HTTP 200.');
  const result = await response.json();
  assert.ok(result.affected > 0);
  await expect(page.getByText(/Threshold settings updated/).first()).toBeVisible();
  return { httpStatus: response.status(), affected: result.affected, changed: result.changed };
}

try {
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`${origin}/admin/settings`);
  console.log('MANUAL_SIGN_IN_REQUIRED: Sign in normally in the isolated browser. Checks start after Settings loads.');
  const selector = page.getByLabel('Tank', { exact: true });
  await page.locator('.modern-admin-shell').waitFor({ timeout: 15 * 60 * 1000 });
  console.log('SIGN_IN_DETECTED: Opening threshold Settings.');
  await page.goto(`${origin}/admin/settings`);
  await selector.waitFor({ timeout: 30000 });
  for (const name of ['Skip for Now', 'Maybe Later']) {
    const invitation = page.getByRole('button', { name, exact: true });
    if (await invitation.isVisible()) await invitation.click();
  }
  stage = 'baseline_and_fallback';
  const before = await snapshot();
  assert.ok(before.tanks.length > 0, 'An owned tank is required.');
  assert.ok(before.legacy, 'Legacy configuration required for compatibility check.');
  assert.equal(before.rows.filter(row => row.tank_id).length, 0, 'Existing overrides require a tailored test plan.');
  report.authenticated = true;
  const tankId = before.tanks[0].id;
  const original = resolveTankThresholds(thresholdBundle(before.rows), tankId);
  assert.deepEqual(original, normalizeThresholds(before.legacy));
  report.legacyFallbackBeforeOverride = true;
  await selector.selectOption(tankId);
  const water = page.getByLabel('Minimum Water Level value');
  await expect(water).toHaveValue(String(original.waterLevelMin));
  assert.ok(original.waterLevelMin >= 0 && original.waterLevelMin <= 20, 'Configured depth requires review.');
  const testValue = Number((original.waterLevelMin + (original.waterLevelMin >= 19.9 ? -0.1 : 0.1)).toFixed(1));
  assert.notEqual(testValue, original.waterLevelMin);
  stage = 'apply_this_tank';
  await water.fill(String(testValue));
  temporaryChange = { tankId, waterLevelMin: original.waterLevelMin };
  report.applyThisTank = await applyUi('single_tank');
  assert.equal(report.applyThisTank.changed, 1);
  const single = await snapshot();
  assert.deepEqual(single.legacy, before.legacy, 'Single Apply changed legacy data.');
  assert.equal(single.rows.filter(row => row.tank_id).length, 1);
  assert.equal(single.rows.find(row => row.tank_id === tankId).thresholds.waterLevelMin, testValue);
  const singleLogs = single.logs.filter(log => !before.logs.some(old => old.id === log.id));
  assert.equal(singleLogs.length, 1);
  assert.equal(singleLogs[0].tank_id, tankId);
  assert.equal(singleLogs[0].metadata.scope, 'single_tank');
  assert.equal(singleLogs[0].metadata.source, 'manual');
  assert.ok(single.actorAttribution);
  report.singleTankIsolation = true;
  report.singleTankActivity = singleLogs.length;
  stage = 'refresh_and_other_tank_fallback';
  await page.reload();
  await expect(water).toHaveValue(String(testValue));
  report.persistenceAfterRefresh = true;
  const fallbackTank = before.tanks.find(tank => tank.id !== tankId);
  if (fallbackTank) {
    await selector.selectOption(fallbackTank.id);
    await expect(water).toHaveValue(String(original.waterLevelMin));
    report.otherTankLegacyFallback = true;
  } else report.otherTankLegacyFallback = 'Only one owned tank; initial fallback verified.';
  stage = 'apply_all_restore_original_effective_values';
  await selector.selectOption(tankId);
  for (const [key, label] of Object.entries(labels)) await page.getByLabel(`${label} value`).fill(String(original[key]));
  const preAll = await snapshot();
  assert.deepEqual(preAll.legacy, before.legacy, 'Legacy data changed concurrently; stop before Apply All.');
  report.applyAll = await applyUi('all_tanks');
  temporaryChange = null;
  assert.equal(report.applyAll.affected, before.tanks.length);
  const all = await snapshot();
  for (const tank of before.tanks) assert.deepEqual(normalizeThresholds(all.rows.find(row => row.tank_id === tank.id)), original);
  assert.deepEqual(normalizeThresholds(all.legacy), original);
  assert.equal(all.legacy.id, before.legacy.id);
  assert.equal(all.legacy.created_at, before.legacy.created_at);
  for (const [key, column] of Object.entries({ temperatureMin: 'temperature_min', temperatureMax: 'temperature_max',
    phMin: 'ph_min', phMax: 'ph_max', turbidityMax: 'turbidity_max', waterLevelMin: 'water_level_min', ammoniaMax: 'ammonia_max' })) {
    assert.equal(Number(all.legacy[column]), original[key]);
  }
  const allLogs = all.logs.filter(log => !single.logs.some(old => old.id === log.id));
  assert.equal(allLogs.length, report.applyAll.changed);
  assert.ok(allLogs.every(log => log.metadata.scope === 'all_tanks' && log.metadata.source === 'manual'));
  assert.ok(all.actorAttribution);
  report.legacyJsonAndColumnsSynchronized = true;
  report.legacyIdentityPreserved = true;
  report.applyAllActivity = allLogs.length;
  stage = 'legacy_mobile_write_and_rls';
  report.compatibility = await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.js');
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data?.user) throw new Error('Verified user required.');
    const uid = auth.data.user.id;
    const legacy = await supabase.from('threshold_settings').select('*').eq('user_id', uid).maybeSingle();
    if (legacy.error || !legacy.data) throw new Error('Legacy singular read failed.');
    // Same-row/same-value mobile-style upsert; no fake threshold-change activity.
    const saved = await supabase.from('threshold_settings').upsert(legacy.data, { onConflict: 'user_id' }).select('*').single();
    if (saved.error || saved.data.id !== legacy.data.id) throw new Error('Legacy user-only upsert failed.');
    const unownedId = crypto.randomUUID();
    const owned = await supabase.from('tanks').select('id').eq('user_id', uid).eq('id', unownedId);
    if (owned.error || owned.data.length) throw new Error('Ownership probe could not be prepared.');
    const denied = await supabase.rpc('apply_tank_thresholds', { p_tank_id: unownedId, p_patch: { waterLevelMin: 5 }, p_scope: 'single_tank', p_source: 'manual' });
    if (denied.error?.code !== '42501') throw new Error('Unowned Apply was not rejected.');
    const hidden = await supabase.from('tank_threshold_settings').select('id').eq('user_id', unownedId);
    if (hidden.error || hidden.data.length) throw new Error('Owner RLS verification failed.');
    return { userOnlySingularRead: true, userOnlyUpsert: true, unownedApplyRejected: true, ownerRlsVerified: true };
  });
  const final = await snapshot();
  assert.deepEqual(final.legacy, all.legacy);
  assert.deepEqual(final.rows, all.rows);
  assert.equal(final.logs.length, all.logs.length, 'Compatibility probe fabricated activity.');
  await page.reload();
  await expect(water).toHaveValue(String(original.waterLevelMin));
  report.originalEffectiveThresholdsRestored = true;
  report.success = true;
  fs.writeFileSync('.security-remote-threshold-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  report.success = false;
  report.failedStage = stage;
  report.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  // Classify locally; never export raw exception messages, which may contain URLs.
  report.failureCategory = error?.name === 'TimeoutError' ? 'ui_timeout'
    : /Target.*closed|browser.*closed|page.*closed/i.test(error?.message || '') ? 'browser_closed'
      : error?.name === 'AssertionError' ? 'verification_failed' : 'operation_failed';
  report.browserConnected = browser.isConnected();
  report.pageClosed = !page || page.isClosed();
  if (temporaryChange && page && !page.isClosed()) {
    report.temporaryChangeRestored = await page.evaluate(async change => {
      const { supabase } = await import('/src/lib/supabase.js');
      const result = await supabase.rpc('apply_tank_thresholds', { p_tank_id: change.tankId,
        p_patch: { waterLevelMin: change.waterLevelMin }, p_scope: 'single_tank', p_source: 'manual' });
      return !result.error;
    }, temporaryChange).catch(() => false);
  }
  fs.writeFileSync('.security-remote-threshold-results.json', JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  await browser.close();
}
