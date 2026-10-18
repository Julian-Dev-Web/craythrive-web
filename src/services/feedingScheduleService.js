import { normalizeFeedingSchedule, validFeedingSchedule } from '../../supabase/functions/_shared/feedingSchedule.js';

export const FEEDING_SCHEDULE_CHANGED = 'craythrive:feeding-schedule-changed';
function verifiedSnapshot(data, tankId) {
  if (!data || data.tank_id !== tankId || typeof data.exists !== 'boolean' || typeof data.can_save !== 'boolean'
    || data.exists && (!data.settings || typeof data.settings !== 'object')) throw new Error('Unverified schedule response');
  return { ...data, settings: normalizeFeedingSchedule(data.settings || {}), invalid: data.exists && !validFeedingSchedule(data.settings) };
}
export async function loadFeedingSchedule(client, tankId, signal) {
  if (!tankId) throw new Error('Select a tank.');
  let query = client.rpc('get_tank_feeding_schedule', { p_tank_id: tankId });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return verifiedSnapshot(data, tankId);
}
export async function saveFeedingSchedule(client, tankId, schedule, signal) {
  if (!tankId || !validFeedingSchedule(schedule)) throw new Error('Invalid feeding schedule.');
  let query = client.rpc('save_tank_feeding_schedule', { p_tank_id: tankId, p_enabled: schedule.auto_feeding_enabled,
    p_hour: schedule.auto_feed_hour, p_minute: schedule.auto_feed_minute, p_cycles: schedule.auto_feed_cycles });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  const saved = verifiedSnapshot(data, tankId);
  if (!saved.exists || saved.invalid || Object.keys(schedule).some(key => schedule[key] !== saved.settings[key])) throw new Error('Saved settings did not match');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FEEDING_SCHEDULE_CHANGED, { detail: { tankId } }));
  return saved;
}
export function feedingScheduleError(error) {
  if (['PGRST202', '42883', '42P01', '42703'].includes(error?.code)) return 'Feeding schedule setup needs the database migration. Your changes have not been saved.';
  if (error?.code === '21000') return 'This tank has conflicting automation settings. Ask the project administrator to review them.';
  if (error?.code === '42501') return 'This feeding schedule could not be verified for your account. Sign in again or contact support.';
  return 'Could not verify or save the feeding schedule. Reload the saved settings before retrying.';
}
