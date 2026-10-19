import { normalizeFeedingSchedule, validFeedingSchedule } from '../../supabase/functions/_shared/feedingSchedule.js';

export const FEEDING_SCHEDULE_CHANGED = 'craythrive:feeding-schedule-changed';
const fields = ['auto_feeding_enabled', 'auto_feed_hour', 'auto_feed_minute', 'auto_feed_cycles'];
const columns = ['user_id', 'tank_id', 'device_uid', ...fields].join(',');
const abortable = (query, signal) => signal ? query.abortSignal(signal) : query;
const accessError = () => Object.assign(new Error('Tank ownership could not be verified.'), { code: '42501' });

async function ownedTank(client, tankId, signal) {
  if (!tankId) throw new Error('Select a tank.');
  const { data: auth, error: authError } = await client.auth.getUser();
  const userId = auth?.user?.id;
  if (authError || !userId) throw accessError();
  const { data: tank, error } = await abortable(client.from('tanks').select('*').eq('id', tankId).eq('user_id', userId), signal).maybeSingle();
  if (error) throw error;
  if (!tank || tank.id !== tankId || tank.user_id !== userId) throw accessError();
  return { tank, userId };
}

function snapshot(row, tankId, userId) {
  if (row && (row.tank_id !== tankId || row.user_id !== userId)) throw accessError();
  return { tank_id: tankId, exists: !!row, can_save: true, actuator_uid: row?.device_uid || null,
    settings: normalizeFeedingSchedule(row || {}), invalid: !!row && !validFeedingSchedule(row) };
}

async function readSettings(client, tankId, userId, signal) {
  const { data, error } = await abortable(client.from('tank_automation_settings').select(columns)
    .eq('user_id', userId).eq('tank_id', tankId), signal).maybeSingle();
  if (error) throw error;
  if (data && (data.tank_id !== tankId || data.user_id !== userId)) throw accessError();
  return data;
}

async function actuatorUid(client, tank, userId, signal) {
  const preferred = tank.actuator_device_uid || tank.actuator_uid || tank.actuator_device;
  const { data, error } = await abortable(client.from('iot_devices').select('device_uid,user_id,tank_id,device_type,is_claimed')
    .eq('user_id', userId).eq('tank_id', tank.id).eq('device_type', 'actuator_hub').eq('is_claimed', true), signal);
  if (error) throw error;
  const devices = (data || []).filter(device => device.user_id === userId && device.tank_id === tank.id
    && device.device_type === 'actuator_hub' && device.is_claimed === true && device.device_uid);
  if (devices.some(device => device.device_uid === preferred)) return preferred;
  if (devices.length > 1) throw Object.assign(new Error('Ambiguous actuator pairing'), { code: '21000' });
  if (devices.length === 1) return devices[0].device_uid;
  if (preferred) {
    const { data: paired, error: pairedError } = await abortable(client.from('iot_devices')
      .select('device_uid,user_id,tank_id,device_type,is_claimed').eq('user_id', userId).eq('device_uid', preferred)
      .eq('device_type', 'actuator_hub').eq('is_claimed', true), signal).maybeSingle();
    if (pairedError) throw pairedError;
    if (paired?.user_id === userId && !paired.tank_id && paired.device_uid === preferred
      && paired.device_type === 'actuator_hub' && paired.is_claimed === true) return preferred;
  }
  return null;
}

export async function loadFeedingSchedule(client, tankId, signal) {
  const { userId } = await ownedTank(client, tankId, signal);
  return snapshot(await readSettings(client, tankId, userId, signal), tankId, userId);
}
export async function saveFeedingSchedule(client, tankId, schedule, signal) {
  if (!tankId || !validFeedingSchedule(schedule)) throw new Error('Invalid feeding schedule.');
  const { tank, userId } = await ownedTank(client, tankId, signal);
  const existing = await readSettings(client, tankId, userId, signal);
  // Never send a cached water setting or device binding in an update.
  const values = Object.fromEntries(fields.map(field => [field, schedule[field]]));
  const update = () => abortable(client.from('tank_automation_settings').update(values)
    .eq('user_id', userId).eq('tank_id', tankId).select(columns), signal).single();
  let result;
  if (existing) result = await update();
  else {
    const deviceUid = await actuatorUid(client, tank, userId, signal);
    result = await abortable(client.from('tank_automation_settings').insert({ user_id: userId, tank_id: tankId,
      ...values, ...(deviceUid ? { device_uid: deviceUid } : {}) }).select(columns), signal).single();
    // Another settings writer may create the unique tank row after our read.
    // Retry with the same narrow patch instead of overwriting its other fields.
    if (result.error?.code === '23505') result = await update();
  }
  const { data, error } = result;
  if (error) throw error;
  const saved = snapshot(data, tankId, userId);
  if (!saved.exists || saved.invalid || fields.some(key => values[key] !== saved.settings[key])) throw new Error('Saved settings did not match');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FEEDING_SCHEDULE_CHANGED, { detail: { tankId } }));
  return saved;
}
export function feedingScheduleError(error) {
  if (['42P01', '42703', 'PGRST204'].includes(error?.code)) return 'Automatic feeding database fields are unavailable. Your changes have not been saved.';
  if (['21000', 'PGRST116'].includes(error?.code)) return 'This tank has conflicting or unavailable automation settings. Reload and retry.';
  if (error?.code === '42501') return 'This feeding schedule could not be verified for your account. Sign in again or contact support.';
  return 'Could not verify or save the feeding schedule. Reload the saved settings before retrying.';
}
