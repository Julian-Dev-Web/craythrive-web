import { applyPhilippineDateFilter, philippineDateRange } from '../utils/philippineTime';
import { buildTankActivity } from '../../supabase/functions/_shared/tankActivity.js';

const PAGE_SIZE = 100;
const MAX_ROWS = 1000;
const missingRPC = error => error?.code === 'PGRST202' || error?.code === '42883';
const missingHistoryRPC = new WeakSet();
const sourceNames = { device_commands: 'Equipment commands', control_logs: 'Control and threshold activity',
  alerts: 'Sensor and action alerts', ammonia_readings: 'Ammonia history', tank_automation_logs: 'Automation history' };

export async function loadTankActivity(client, { tankId, fromDate = '', toDate = '', signal, recheckAutomation = false }) {
  if (!tankId) throw new Error('Select a tank to view its activity.');
  if (fromDate && toDate && fromDate > toDate) throw new Error('The start date must be on or before the end date.');
  const dates = philippineDateRange(fromDate, toDate);
  const { data: auth, error: authError } = await client.auth.getUser();
  const userId = auth?.user?.id;
  if (authError || !userId) throw new Error('Sign in again to view tank activity.');
  let tankQuery = client.from('tanks').select('*').eq('id', tankId).eq('user_id', userId);
  if (signal) tankQuery = tankQuery.abortSignal(signal);
  const { data: tank, error: tankError } = await tankQuery.maybeSingle();
  if (tankError || !tank || tank.user_id !== userId || tank.id !== tankId) throw new Error('This tank could not be verified for your account.');
  const notices = [];
  const sources = {};
  if (recheckAutomation) missingHistoryRPC.delete(client);
  const readTable = async (source, offset) => {
    let query = client.from(source).select('*').eq('tank_id', tankId);
    // Automation rows may omit user_id. The tank has already been verified above;
    // accept its ownerless device logs, never another explicit owner's records.
    query = source === 'tank_automation_logs' ? query.or(`user_id.eq.${userId},user_id.is.null`) : query.eq('user_id', userId);
    query = applyPhilippineDateFilter(query, fromDate, toDate);
    if (signal) query = query.abortSignal(signal);
    return query.order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
  };
  const read = async source => {
    let rows = [];
    try {
      while (rows.length < MAX_ROWS) {
        let data, error;
        if (source === 'tank_automation_logs') {
          if (!missingHistoryRPC.has(client)) {
            let query = client.rpc('get_tank_automation_history', {
              p_tank_id: tankId, p_from: dates.startIso, p_to: dates.endIso, p_offset: rows.length, p_limit: PAGE_SIZE,
            });
            if (signal) query = query.abortSignal(signal);
            ({ data, error } = await query);
            if (missingRPC(error)) missingHistoryRPC.add(client);
          }
          // A review-only SQL file used to be the sole provider of this RPC.
          // Fall back only for an absent RPC, never for ownership/RLS failures.
          if (missingHistoryRPC.has(client)) ({ data, error } = await readTable(source, rows.length));
        } else {
          ({ data, error } = await readTable(source, rows.length));
        }
        if (error || !Array.isArray(data)) throw new Error('Read failed');
        if (data.some(row => (row.user_id !== userId && !(source === 'tank_automation_logs' && row.user_id == null))
          || String(row.tank_id) !== String(tankId))) throw new Error('Unverified scope');
        // Stop on a repeated page instead of looping forever if pagination fails.
        const seen = new Set(rows.map(row => row.id));
        if (data.some(row => seen.has(row.id))) throw new Error('Repeated history page');
        rows = rows.concat(data);
        if (data.length < PAGE_SIZE) break;
      }
      sources[source] = rows;
      if (rows.length === MAX_ROWS) notices.push(`${sourceNames[source]}: showing at most ${MAX_ROWS} records. Narrow the dates to inspect older activity.`);
    } catch {
      notices.push(`${sourceNames[source]} could not be verified. Retry to load this part of the history.`);
    }
  };
  await Promise.all(['device_commands', 'control_logs', 'alerts', 'ammonia_readings', 'tank_automation_logs'].map(read));
  if (signal?.aborted) throw new Error('Activity request timed out or was interrupted. Reconnect and retry.');
  if (!Object.keys(sources).length) throw new Error('Activity could not be loaded. Reconnect and retry.');
  return { tank, events: buildTankActivity({ tank, userId, sources }), notices };
}
