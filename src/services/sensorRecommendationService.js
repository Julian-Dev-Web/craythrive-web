import { fetchThresholdRows, thresholdBundle } from './tankThresholdService';
import { buildMonitoringRecords, getCurrentTankSnapshot } from '../utils/monitoringRecords';
import { buildMonitoringAIContext } from '../utils/monitoringAIContext';
import { readLatestTankObservation } from './tankSnapshotService';

// Strict, read-only evidence loading. Unlike history fallbacks, a failed read
// must not masquerade as a verified current recommendation snapshot.
export async function loadTankRecommendationContext(client, tankId) {
  if (!client || !tankId) throw new Error('Select a tank and reconnect to load recommendations.');
  const { data: auth, error: authError } = await client.auth.getUser();
  const userId = auth?.user?.id;
  if (authError || !userId) throw new Error('Sign in again to load recommendations.');
  const { data: tank, error: tankError } = await client.from('tanks').select('*')
    .eq('id', tankId).eq('user_id', userId).maybeSingle();
  if (tankError || !tank || tank.id !== tankId || tank.user_id !== userId) {
    throw new Error('This tank could not be verified for your account.');
  }
  const latest = async table => {
    const row = await readLatestTankObservation(client, table, tank, userId);
    return row ? [row] : [];
  };
  let rows, sensor, ammonia;
  try {
    [rows, sensor, ammonia] = await Promise.all([
      fetchThresholdRows(client, userId), latest('sensor_readings'), latest('ammonia_readings'),
    ]);
  } catch {
    throw new Error('Readings or thresholds could not be verified. Reconnect and retry.');
  }
  const thresholds = thresholdBundle(rows);
  const records = buildMonitoringRecords(sensor, ammonia, [tank], thresholds);
  const snapshot = getCurrentTankSnapshot(records, tank, thresholds);
  return { tank, records, thresholds, snapshot };
}

export function recommendationInputs(context, nowMs) {
  const { tank, snapshot } = context;
  const water = snapshot.waterRecord;
  const normalized = water?.normalized;
  const raw = normalized?.raw;
  return { tankId: tank.id, tankName: snapshot.tankName, nowMs,
    thresholds: snapshot.safety.activeThresholds, parameters: snapshot.safety.parameters,
    readings: {
      temperature: { value: normalized?.temperatureValue, timestamp: water?.date, status: raw?.temperature_status },
      ph: { value: normalized?.phValue, timestamp: water?.date, status: raw?.ph_status },
      turbidity: { value: normalized?.turbidityValue, timestamp: water?.date, status: raw?.turbidity_status },
      waterLevel: { value: normalized?.waterValue, timestamp: water?.date,
        status: raw?.water_status, health: snapshot.safety.parameters.waterLevel.health },
      ammonia: { value: snapshot.ammoniaRecord?.ammoniaValue, timestamp: snapshot.ammoniaRecord?.date },
    },
  };
}

// Only explanation text is returned. AI actions, statuses and threshold
// suggestions are deliberately absent from the caller's result.
export async function explainSensorRecommendations(client, context, recommendations, signal) {
  const monitoring = buildMonitoringAIContext(context);
  const live = recommendations.filter(item => item.parameter !== 'ammonia');
  const currentCondition = live.some(item => item.severity === 'critical') ? 'Critical'
    : live.some(item => item.severity === 'warning') ? 'Warning'
    : live.some(item => item.severity === 'no-data') ? 'Current condition unavailable' : 'Normal';
  if (monitoring.latest_sensor) monitoring.latest_sensor = { ...monitoring.latest_sensor, condition: currentCondition };
  if (monitoring.latest_ammonia) monitoring.latest_ammonia = { ...monitoring.latest_ammonia,
    condition: recommendations.find(item => item.parameter === 'ammonia')?.status || 'Unavailable' };
  let response;
  try {
    response = await client.functions.invoke('craythrive-ai-guide', { signal, body: {
      question: 'Explain these CrayThrive tank recommendations in simple farmer-friendly language. Use the supplied deterministic results unchanged. Missing, stale and unverified manual scans cannot establish current condition. Describe only inspection and verification steps. Do not suggest numerical critical limits, chemical dosages, threshold changes or automatic actions. State that this explanation changes no safety status or equipment setting.',
      context: { ...monitoring, tank: { id: context.tank.id, name: monitoring.tank_name },
        thresholds: context.snapshot.safety.activeThresholds,
        rule_based_result: { recommendations, classification_note: 'Existing evaluator. Separate numeric critical boundaries are not configured. Missing scan-validity policy is not permission to call ammonia live.' },
        capabilities: { explanation_only: true, automatic_actions: false, threshold_changes: false } },
      history: [],
    } });
  } catch {
    throw new Error('AI Guide is unavailable. The sensor recommendations are still available.');
  }
  const { data, error } = response;
  if (error) {
    const status = error.context?.status;
    throw new Error(status === 429 ? 'AI Guide is busy. Please wait before trying again.'
      : [401, 403].includes(status) ? 'AI Guide could not verify access. Sign in again or retry.'
      : 'AI Guide is unavailable. The sensor recommendations are still available.');
  }
  const text = typeof data?.message === 'string' ? data.message : typeof data?.answer === 'string' ? data.answer : '';
  if (!text.trim()) throw new Error('AI Guide returned no explanation. Please retry later.');
  return text.trim().slice(0, 5000);
}
