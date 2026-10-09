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

// Caller supplies its authenticated client and verified user ID. AI must verify
// tank ownership first. Do not use a service-role client to bypass caller RLS.
// A missing tank is an error, rather than an inferred account-wide operation.
export async function fetchEffectiveTankThresholds(client, userId, tankId) {
  if (!userId || !tankId) throw new Error('Authenticated user and selected tank are required.');
  const specific = await client.from('threshold_settings').select('*')
    .eq('user_id', userId).eq('tank_id', tankId).maybeSingle();
  if (specific.error) {
    // Pre-migration schema only. Never turn authorization/network/duplicate-row
    // failures into seemingly successful default settings.
    const missingTankColumn = ['42703', 'PGRST204'].includes(specific.error.code)
      && /\btank_id\b/.test(specific.error.message || '');
    if (!missingTankColumn) throw specific.error;
    const legacy = await client.from('threshold_settings').select('*').eq('user_id', userId).maybeSingle();
    if (legacy.error) throw legacy.error;
    return normalizeThresholds(legacy.data);
  }
  if (specific.data) return normalizeThresholds(specific.data);
  const legacy = await client.from('threshold_settings').select('*')
    .eq('user_id', userId).is('tank_id', null).maybeSingle();
  if (legacy.error) throw legacy.error;
  return normalizeThresholds(legacy.data);
}
