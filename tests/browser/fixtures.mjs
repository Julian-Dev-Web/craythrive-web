import { test as base, expect } from '@playwright/test';

export const user = { id: '11111111-1111-4111-8111-111111111111', email: 'farmer@example.invalid', role: 'authenticated', aud: 'authenticated' };
const now = new Date().toISOString();
const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.qa-only-not-a-real-signature';
export const session = { access_token: token, refresh_token: 'qa-only-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
export function datasets() {
  return {
    profiles: [{ ...user, role: 'user', username: 'QA Farmer', full_name: 'QA Farmer' }],
    tanks: [
      { id: 'tank-a', name: 'Tank A', user_id: user.id, device_uid: 'device-a', is_paired: true, created_at: now },
      { id: 'tank-b', name: 'Tank B', user_id: user.id, device_uid: 'device-b', is_paired: true, created_at: now },
      { id: 'tank-c', name: 'Unpaired Tank With A Very Long Name For Responsive Layout Verification', user_id: user.id, created_at: now },
    ],
    sensor_readings: [
      { id: 'water-a', tank_id: 'tank-a', user_id: user.id, device_uid: 'device-a', temperature_c: 26.3, ph_value: 4.8, ph: 7.2, turbidity_voltage: 2.8, water_depth_cm: 0.6, water_distance_cm: 20, water_status: 'Safe Ideal', ph_status: 'Safe Ideal', temperature_status: 'Critical', created_at: now },
      { id: 'water-b', tank_id: 'tank-b', user_id: user.id, device_uid: 'device-b', temperature_c: 26.3, ph_value: 7.2, turbidity_voltage: 2.8, water_depth_cm: 5, created_at: now },
    ],
    ammonia_readings: [
      { id: 'scan-a', tank_id: 'tank-a', user_id: user.id, ammonia: 0.1, ammonia_status: 'Critical', created_at: new Date(Date.now() - 86400000).toISOString() },
      { id: 'scan-b', tank_id: 'tank-b', user_id: user.id, ammonia: 0.6, ammonia_status: 'Normal', created_at: now },
    ],
    threshold_settings: [{ user_id: user.id, thresholds: { temperatureMin: 20, temperatureMax: 30, phMin: 6.5, phMax: 8.5, turbidityMax: 2.5, waterLevelMin: 4.5, ammoniaMax: 0.25 } }],
    marketplace_listings: [
      { id: 'listing-a', user_id: user.id, seller_id: user.id, title: 'QA Legacy Crayfish', category: null, subcategory: 'Adult', crayfish_type: 'Redclaw Crayfish', stage: 'adult', sex: 'unknown', size_label: '1 inch', price: 150, quantity: 12, stock: 12, status: 'active', is_active: true, is_deleted: false, description: 'Healthy crayfish for QA', image_url: '/craythrive-logo.png', location: 'Manila', created_at: now },
      { id: 'listing-b', user_id: user.id, seller_id: user.id, title: 'QA Fish Feed', category: 'feeds', price: 80, quantity: 10, stock: 10, status: 'active', is_active: true, is_deleted: false, image_url: '/craythrive-logo.png', created_at: now },
    ],
    seller_profiles: [{ id: user.id, user_id: user.id, seller_id: user.id, store_name: 'QA Store With A Long Name For Responsive Verification', seller_mobile: '09000000000', phone: '09000000000', pickup_municipality: 'Malolos', pickup_municipality_code: '031410000', pickup_barangay: 'Poblacion', pickup_barangay_code: '031410001', is_active: true, website_url: 'javascript:alert(1)', facebook_url: 'https://example.invalid/store', created_at: now }],
    marketplace_orders: [{ id: 'order-a', listing_id: 'listing-a', seller_id: user.id, buyer_id: user.id, user_id: user.id, quantity: 1, total_price: 150, status: 'pending', created_at: now }],
    alerts: [], iot_devices: [], device_commands: [], control_logs: [], notification_preferences: [],
    marketplace_chat_threads: [], marketplace_chat_messages: [],
  };
}

export const test = base.extend({
  qa: async ({ context, page }, use) => {
    const state = { data: datasets(), authenticated: true, invalidLogin: false, expired: false, authDelay: 0, tankWriteDelay: 0, tankWriteFailure: false,
      developerAuthorized: false, developerVerified: false, developerDenied: false, developerInvalidOtp: false, developerOperationStatus: 0,
      backupHistory: [], backupUnchanged: false, backupScheduleEnabled: true, backupLastRun: null,
      developerFactors: [{ id: '33333333-3333-4333-8333-333333333333', factor_type: 'totp', status: 'verified', friendly_name: 'QA Authenticator' }],
      developerRequests: [], authRequests: [], reads: [], writes: [], errors: [], warnings: [], localFailures: [], externalRequests: [] };
    await context.addInitScript(({ session }) => {
      localStorage.setItem('sb-qa-auth-token', JSON.stringify(session));
      window.print = () => { window.__qaPrintCalled = true; };
    }, { session });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname === '127.0.0.1') return route.continue();
      state.externalRequests.push(url.hostname);
      if (url.hostname !== 'qa.supabase.invalid') {
        if (url.hostname === 'psgc.cloud') return route.fulfill({ json: url.pathname.endsWith('/barangays')
          ? [{ code: '031410001', name: 'Poblacion' }]
          : [{ code: '031410000', name: 'Malolos' }] });
        // Fonts and address lookup are not part of the backend under test.
        return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/json', body: url.pathname.endsWith('.css') ? '' : '[]' });
      }
      const reply = (json, status = 200) => route.fulfill({ status, json });
      if (url.pathname.startsWith('/functions/v1/developer-')) {
        state.developerRequests.push({ path: url.pathname, body: request.postDataJSON(), authorization: request.headers().authorization });
        if (!state.authenticated || state.expired || !state.developerAuthorized) {
          state.developerDenied = true; return reply({ authorized: false }, 403);
        }
        if (url.pathname.endsWith('/developer-access')) return reply({ authorized: true, reauthenticationRequired: !state.developerVerified,
          verifiedUntil: state.developerVerified ? Math.floor(Date.now() / 1000) + 300 : null });
        if (!state.developerVerified) return reply({ authorized: false }, 403);
        if (state.developerOperationStatus) return reply({ error: 'QA operation rejected' }, state.developerOperationStatus);
        const envelope = { format: 'craythrive-backup', version: 1, iv: 'qa-only-iv', ciphertext: 'qa-only-encrypted-fixture' };
        const action = request.postDataJSON().action;
        if (url.pathname.endsWith('/developer-backup')) {
          if (action === 'history') {
            const cursor = request.postDataJSON().cursor;
            const offset = cursor ? state.backupHistory.findIndex(item => item.id === cursor.id) + 1 : 0;
            const entries = state.backupHistory.slice(offset, offset + 20);
            return reply({ entries, nextCursor: state.backupHistory.length > offset + 20 ? { id: entries.at(-1).id, createdAt: entries.at(-1).createdAt } : null,
              lastRun: state.backupLastRun, schedule: { enabled: state.backupScheduleEnabled, time: '23:55', timeZone: 'Asia/Manila', nextRunAt: new Date(Date.now() + 86400000).toISOString() } });
          }
          if (action === 'download') {
            const item = state.backupHistory.find(item => item.id === request.postDataJSON().id);
            return item ? reply({ backup: envelope, createdAt: item.createdAt, tables: [], excludedTables: [] }) : reply({ error: 'Missing backup' }, 404);
          }
          if (!state.backupUnchanged) state.backupHistory.unshift({ id: '55555555-5555-4555-8555-555555555555', createdAt: new Date().toISOString(), backupDay: '2026-10-08', source: 'manual', recordCount: 4, tableCount: 2, byteSize: 1024 });
          state.backupLastRun = { checkedAt: new Date().toISOString(), source: 'manual', status: state.backupUnchanged ? 'skipped' : 'saved', reason: state.backupUnchanged ? 'no_data_changes' : 'data_changed' };
          return reply({ backup: envelope, createdAt: now, status: state.backupUnchanged ? 'skipped' : 'saved', tables: [{ name: 'profiles', rows: 1 }, { name: 'tanks', rows: 3 }], excludedTables: [] });
        }
        if (action === 'preview') return reply({ createdAt: now, tables: [{ name: 'profiles', inserted: 0, updated: 0, unchanged: 1 },
          { name: 'tanks', inserted: 1, updated: 1, unchanged: 1 }], skippedTables: ['device_commands', 'push_tokens', 'tank_automation_settings'],
          expiresAt: Math.floor(Date.now() / 1000) + 120, previewToken: { ...envelope, ciphertext: 'qa-only-preview-proof' }, recoveryBackup: envelope });
        if (action === 'apply' && request.postDataJSON().confirmation === 'RESTORE' && request.postDataJSON().previewToken?.ciphertext === 'qa-only-preview-proof') return reply({ restored: true, tables: [], completedAt: now });
        return reply({ error: 'Invalid request' }, 400);
      }
      if (url.pathname.startsWith('/auth/v1/')) {
        state.authRequests.push(url.pathname);
        if (url.pathname.endsWith('/user')) return state.authenticated && !state.expired ? reply({ ...user, factors: state.developerFactors }) : reply({ message: 'Invalid JWT', code: 'bad_jwt' }, 401);
        if (url.pathname.endsWith('/factors') && request.method() === 'POST') {
          const factor = { id: '44444444-4444-4444-8444-444444444444', factor_type: 'totp', status: 'unverified', friendly_name: 'CrayThrive Developer' };
          state.developerFactors.push(factor);
          return reply({ ...factor, totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="black"/></svg>', secret: 'qa-only-secret', uri: 'otpauth://qa-only' } });
        }
        if (/\/factors\/[^/]+\/challenge$/.test(url.pathname)) return reply({ id: 'qa-challenge', expires_at: Math.floor(Date.now() / 1000) + 300 });
        if (/\/factors\/[^/]+\/verify$/.test(url.pathname)) {
          if (request.postDataJSON().code !== '123456') { state.developerInvalidOtp = true; return reply({ message: 'Invalid OTP', code: 'mfa_verification_failed' }, 401); }
          state.developerVerified = true;
          state.developerFactors.forEach(factor => { factor.status = 'verified'; });
          return reply({ ...session, user: { ...user, factors: state.developerFactors } });
        }
        if (url.pathname.endsWith('/token')) {
          if (state.authDelay) await new Promise(resolve => setTimeout(resolve, state.authDelay));
          if (state.invalidLogin || state.expired) return reply({ message: 'Invalid login credentials', code: 'invalid_credentials' }, 400);
          state.authenticated = true; return reply(session);
        }
        if (url.pathname.endsWith('/logout')) state.authenticated = false;
        return reply({});
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        // Supabase rejects browser/public-key schema discovery. Table CRUD works.
        if (url.pathname === '/rest/v1/') return reply({ message: 'Access to schema is forbidden' }, 403);
        const table = url.pathname.split('/').at(-1);
        if (url.pathname === '/rest/v1/rpc/apply_tank_thresholds') {
          if (state.thresholdWriteFailure) return reply({ code: 'PGRST202', message: 'Migration not installed' }, 404);
          const args = request.postDataJSON();
          const selected = state.data.tanks.find(tank => tank.id === args.p_tank_id && tank.user_id === user.id);
          if (!selected) return reply({ code: '42501', message: 'Tank ownership required' }, 403);
          let legacyRow = state.data.threshold_settings.find(row => row.user_id === user.id && !row.tank_id);
          const legacy = legacyRow?.thresholds || {};
          const selectedRow = state.data.threshold_settings.find(row => row.tank_id === selected.id);
          let patch = args.p_patch;
          if (args.p_source === 'ai_recommendation') {
            const s = selectedRow?.pending_ai_suggestion;
            if (!s) return reply({ message: 'No recommendation' }, 400);
            patch = { waterLevelMin: s.suggested_value };
          }
          if (args.p_scope === 'all_tanks') patch = { ...(selectedRow?.thresholds || legacy), ...patch };
          const targets = state.data.tanks.filter(tank => tank.user_id === user.id && (args.p_scope === 'all_tanks' || tank.id === selected.id));
          const saved = []; let changed = 0;
          for (const tank of targets) {
            let row = state.data.threshold_settings.find(row => row.tank_id === tank.id);
            const oldValues = structuredClone(row?.thresholds || legacy);
            const newValues = { ...oldValues, ...patch };
            state.writes.push({ table: 'threshold_settings', method: 'RPC', body: { ...args, tank_id: tank.id } });
            if (!row) { row = { id: `threshold-${tank.id}`, tank_id: tank.id, user_id: user.id }; state.data.threshold_settings.push(row); }
            row.thresholds = newValues;
            if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) {
              changed++;
              state.data.control_logs.push({ id: `threshold-activity-${state.data.control_logs.length}`, tank_id: tank.id, user_id: user.id,
                action_type: 'threshold_updated', action_status: 'updated', created_at: new Date().toISOString(),
                notes: `Water Level Minimum: ${oldValues.waterLevelMin} cm → ${newValues.waterLevelMin} cm.${args.p_source === 'ai_recommendation' ? ' AI recommendation accepted by user.' : ''}`,
                metadata: { source: args.p_source, scope: args.p_scope, old_values: oldValues, new_values: newValues } });
            }
            saved.push(row);
          }
          if (args.p_scope === 'all_tanks') {
            if (!legacyRow) {
              legacyRow = { id: 'legacy-thresholds', user_id: user.id, tank_id: null };
              state.data.threshold_settings.push(legacyRow);
            }
            legacyRow.thresholds = structuredClone(patch);
          }
          if (args.p_source === 'ai_recommendation') selectedRow.pending_ai_suggestion = null;
          return reply({ affected: targets.length, changed, rows: saved });
        }
        if (request.method() === 'GET') state.reads.push({ table, filters: Object.fromEntries(url.searchParams) });
        let rows = structuredClone(state.data[table] || []);
        for (const [key, value] of url.searchParams) {
          if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
          if (value.startsWith('neq.')) rows = rows.filter(row => String(row[key]) !== value.slice(4));
          if (value.startsWith('is.')) rows = rows.filter(row => value === 'is.null' ? row[key] == null : String(row[key]) === value.slice(3));
        }
        if (request.method() !== 'GET' && request.method() !== 'HEAD') {
          const body = request.postDataJSON();
          state.writes.push({ table, method: request.method(), body });
          if (table === 'tanks' && request.method() === 'POST') {
            if (state.tankWriteDelay) await new Promise(resolve => setTimeout(resolve, state.tankWriteDelay));
            if (state.tankWriteFailure || body.user_id !== user.id) return reply({ code: '42501', message: 'Row-level security rejected the insert' }, 403);
            const columns = ['id', 'user_id', 'tank_name', 'tank_type', 'male_count', 'female_count', 'juvenile_count', 'population_label', 'tank_size_label', 'notes', 'status', 'has_paired_device', 'created_at', 'updated_at'];
            if (Object.keys(body).some(key => !columns.includes(key))) return reply({ code: 'PGRST204', message: 'Unknown tank column' }, 400);
            if (!['Breeder', 'Juvenile'].includes(body.tank_type)) return reply({ code: '23514', message: 'Tank type constraint' }, 400);
          }
          if (request.method() === 'PATCH') {
            rows.forEach(row => {
              Object.assign(row, body);
              const original = state.data[table]?.find(item => item.id === row.id);
              if (original) Object.assign(original, body);
            });
          } else if (body) {
            const conflict = url.searchParams.get('on_conflict');
            const existing = conflict && state.data[table]?.find(row => row[conflict] === body[conflict]);
            if (existing) { Object.assign(existing, body); rows = [existing]; }
            else { rows = [{ id: `qa-created-${state.writes.length}`, ...(table === 'tanks' ? { male_count: 0, female_count: 0, juvenile_count: 0, population_label: null, tank_size_label: null, status: 'Unpaired', has_paired_device: false, created_at: new Date().toISOString() } : {}), ...body }]; state.data[table] = [...(state.data[table] || []), ...rows]; }
          }
        }
        if (url.searchParams.get('order')?.includes('created_at.desc')) rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const total = rows.length;
        if (url.searchParams.has('limit')) rows = rows.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit')));
        const singular = request.headers().accept?.includes('vnd.pgrst.object');
        return route.fulfill({ status: 200, json: singular ? rows[0] || null : rows, headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${total}` } });
      }
      return reply({});
    });
    await context.routeWebSocket(/supabase\.invalid/, () => {});
    page.on('pageerror', error => state.errors.push(error.message));
    page.on('console', message => {
      const expectedAuthFailure = (state.expired || state.invalidLogin || !state.authenticated) &&
        /^Failed to load resource:.*status of (400|401)/.test(message.text());
      const expectedTankFailure = state.tankWriteFailure && /^Failed to load resource:.*status of 403/.test(message.text());
      const expectedDeveloperFailure = (state.developerDenied && /^Failed to load resource:.*status of 403/.test(message.text())) ||
        (state.developerInvalidOtp && /^Failed to load resource:.*status of 401/.test(message.text())) ||
        (state.developerOperationStatus && new RegExp(`^Failed to load resource:.*status of ${state.developerOperationStatus}`).test(message.text()));
      if (message.type() === 'error' && !expectedAuthFailure && !expectedTankFailure && !expectedDeveloperFailure) state.errors.push(message.text());
      if (message.type() === 'warning') state.warnings.push(message.text());
    });
    page.on('response', response => {
      if (response.url().startsWith('http://127.0.0.1:4175') && response.status() >= 400) state.localFailures.push(response.url());
    });
    await use(state);
    expect(state.localFailures, 'local asset/route failures').toEqual([]);
    expect(state.errors, 'browser exceptions / console errors').toEqual([]);
    expect(state.warnings.filter(message => /react|key prop|nesting|hydration/i.test(message)), 'React warnings').toEqual([]);
  },
});
export { expect };
