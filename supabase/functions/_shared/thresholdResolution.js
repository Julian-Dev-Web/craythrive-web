// Portable across Vite, Expo and Deno. No browser state, credentials or writes.
export const DEFAULT_THRESHOLDS = Object.freeze({
  temperatureMin: 20, temperatureMax: 30, phMin: 6.5, phMax: 8.5,
  // Historical name: this is the minimum clear-water sensor voltage.
  turbidityMax: 2.5, waterLevelMin: 4.5, ammoniaMax: 0.25,
});

const columns = {
  temperatureMin: 'temperature_min', temperatureMax: 'temperature_max',
  phMin: 'ph_min', phMax: 'ph_max', turbidityMax: 'turbidity_max',
  waterLevelMin: 'water_level_min', ammoniaMax: 'ammonia_max',
};

export function normalizeThresholds(data) {
  const source = { ...data, ...(data?.safe_thresholds || {}), ...(data?.thresholds || {}) };
  return Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([key, fallback]) => {
    const raw = source[key] ?? source[columns[key]];
    const valid = (typeof raw === 'number' || typeof raw === 'string')
      && String(raw).trim() !== '' && Number.isFinite(Number(raw));
    return [key, valid ? Number(raw) : fallback];
  }));
}

export function thresholdBundle(rows = []) {
  return {
    byTank: Object.fromEntries(rows.filter(row => row.tank_id).map(row => [row.tank_id, normalizeThresholds(row)])),
    legacy: normalizeThresholds(rows.find(row => !row.tank_id)),
  };
}

export function resolveTankThresholds(settings, tankId) {
  return normalizeThresholds(settings?.byTank ? settings.byTank[tankId] || settings.legacy : settings);
}

// The same collection reader serves Web, Expo and the verified AI caller.
// Never query a nonexistent legacy tank_id or discard overrides on RPC fallback.
export async function fetchTankThresholdRows(client, userId) {
  if (!userId) throw new Error('Authenticated user is required.');
  const result = await client.rpc('get_tank_threshold_settings');
  if (!result.error) {
    if (!Array.isArray(result.data)) throw new Error('Invalid tank threshold response.');
    return result.data.filter(row => row.user_id === userId);
  }
  if (!['PGRST202', '42883'].includes(result.error.code)) throw result.error;
  const specific = await client.from('tank_threshold_settings').select('*').eq('user_id', userId);
  if (specific.error) {
    // Only an absent pre-bridge table permits legacy-only reads. Authorization,
    // network and other schema failures must not silently become defaults.
    const missingTable = ['42P01', 'PGRST205'].includes(specific.error.code)
      && /\btank_threshold_settings\b/.test(specific.error.message || '');
    if (!missingTable) throw specific.error;
  }
  const legacy = await client.from('threshold_settings').select('*')
    .eq('user_id', userId).maybeSingle();
  if (legacy.error) throw legacy.error;
  if (!specific.error && !Array.isArray(specific.data)) throw new Error('Invalid tank threshold response.');
  return [
    ...(legacy.data?.user_id === userId ? [{ ...legacy.data, tank_id: null }] : []),
    ...(specific.data || []).filter(row => row.user_id === userId && row.tank_id),
  ];
}

// Caller supplies its authenticated client and verified user ID. AI must verify
// tank ownership first. Do not use a service-role client to bypass caller RLS.
// A missing tank is an error, rather than an inferred account-wide operation.
export async function fetchEffectiveTankThresholds(client, userId, tankId) {
  if (!userId || !tankId) throw new Error('Authenticated user and selected tank are required.');
  return resolveTankThresholds(thresholdBundle(await fetchTankThresholdRows(client, userId)), tankId);
}
