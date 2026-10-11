import { applyPhilippineDateFilter } from '../utils/philippineTime';
import { orderLatestSensorQuery, sensorRowBelongsToTank } from '../../supabase/functions/_shared/sensorReadingContract.js';
import { TABLES, COLUMNS } from "../constants/schema";
import { supabase } from "../lib/supabase";
import { logDiagnostic } from "../utils/securityDiagnostics";

// Manual scan history must not silently stop at a global list limit: an older
// date range can still contain scans. Page through the existing read-only API.
export async function loadAmmoniaHistory(currentUser, client = supabase, dateRange = {}) {
  const rows = [];
  if (!client || !currentUser?.id) return { rows, error: true };
  let offset = 0;
  try {
    while (true) {
      let query = client.from(TABLES.AMMONIA_READINGS).select("*", { count: "exact" });
      query = query.eq(COLUMNS.USER_ID, currentUser.id);
      if (dateRange.tankId) query = query.eq(COLUMNS.TANK_ID, dateRange.tankId);
      query = applyPhilippineDateFilter(query, dateRange.fromDate, dateRange.toDate);
      const { data, error, count } = await orderLatestSensorQuery(query).range(offset, offset + 999);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data);
      offset += data.length;
      if (count != null ? offset >= count : data.length < 1000) break;
    }
    return { rows, error: false };
  } catch (error) {
    logDiagnostic("Could not load complete ammonia history", error);
    return { rows, error: true };
  }
}

export async function loadSensorHistory(currentUser, options = {}, client = supabase) {
  const rows = [];
  if (!client || !currentUser?.id) return { rows, error: true };
  try {
    let offset = 0;
    let more = true;
    while (more) {
      let query = client.from(TABLES.SENSOR_READINGS).select('*').eq(COLUMNS.USER_ID, currentUser.id);
      if (options.tankId) query = query.eq(COLUMNS.TANK_ID, options.tankId);
      query = applyPhilippineDateFilter(query, options.fromDate, options.toDate);
      const size = options.paginate ? 1000 : options.limit || 400;
      const { data, error } = await orderLatestSensorQuery(query).range(offset, offset + size - 1);
      if (error || !Array.isArray(data)) throw error || new Error('Sensor history unavailable.');
      rows.push(...data.filter(row => row.user_id === currentUser.id && (!options.tankId || row.tank_id === options.tankId)));
      more = !!options.paginate && data.length === size;
      offset += data.length;
    }
    return { rows, error: false };
  } catch (error) { logDiagnostic('Could not load sensor history', error); return { rows, error: true }; }
}

// History lists are bounded; a quiet tank's latest scan can be older than that
// global history window. Query each tank independently for its current snapshot.
// This uses the existing frontend schema contract; it creates/writes nothing.
export async function readLatestTankObservation(client, table, tank, userId, signal) {
  const id = tank?.id || tank?.tank_id || tank?.uuid;
  if (!userId || !id || (tank.user_id && tank.user_id !== userId)) throw new Error('Tank ownership could not be verified.');
  let query = orderLatestSensorQuery(client.from(table).select('*')
    .eq(COLUMNS.TANK_ID, id).eq(COLUMNS.USER_ID, userId)).limit(1);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw error || new Error('Latest reading unavailable.');
  if (data.some(row => !sensorRowBelongsToTank(row, tank, userId))) throw new Error('Reading scope could not be verified.');
  return data[0] || null;
}

export async function loadCurrentTankRows(tanks, currentUser, _history = {}, client = supabase, signal) {
  void _history; // Compatibility argument; history is deliberately never a current-data fallback.
  const sensor = [], ammonia = [], errors = [];
  if (!client || !currentUser?.id) return { sensor, ammonia, errors: ['Sign in to load current readings.'] };
  const read = async (tank, table) => {
    try { return await readLatestTankObservation(client, table, tank, currentUser.id, signal); }
    catch (error) {
      if (!signal?.aborted) logDiagnostic(`Could not verify latest ${table} event`, error);
      errors.push({ tankId: tank.id, source: table });
      return null; // Bounded/cached history is not evidence of the current row.
    }
  };
  // Bound concurrent requests without imposing a time limit on scan validity.
  for (let offset = 0; offset < tanks.length; offset += 4) {
    const rows = await Promise.all(tanks.slice(offset, offset + 4).map(async tank => {
      const [water, scan] = await Promise.all([
        read(tank, TABLES.SENSOR_READINGS), read(tank, TABLES.AMMONIA_READINGS),
      ]);
      return { water, scan };
    }));
    for (const { water, scan } of rows) {
      if (water) sensor.push(water);
      if (scan) ammonia.push(scan);
    }
  }
  return { sensor, ammonia, errors };
}
