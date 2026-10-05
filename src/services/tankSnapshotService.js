import { TABLES, COLUMNS } from "../constants/schema";
import { supabase } from "../lib/supabase";
import { logDiagnostic } from "../utils/securityDiagnostics";
import { getLatestAmmoniaForTank, getMonitoringDate, recordMatchesMonitoringTank } from "../utils/monitoringRecords";

// Manual scan history must not silently stop at a global list limit: an older
// date range can still contain scans. Page through the existing read-only API.
export async function loadAmmoniaHistory(currentUser, client = supabase) {
  const rows = [];
  if (!client || !currentUser?.id) return { rows, error: true };
  let offset = 0;
  try {
    while (true) {
      let query = client.from(TABLES.AMMONIA_READINGS).select("*", { count: "exact" });
      if (!currentUser.isAdmin) query = query.eq(COLUMNS.USER_ID, currentUser.id);
      const { data, error, count } = await query.order(COLUMNS.CREATED_AT, { ascending: false, nullsFirst: false }).range(offset, offset + 999);
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

// History lists are bounded; a quiet tank's latest scan can be older than that
// global history window. Query each tank independently for its current snapshot.
// This uses the existing frontend schema contract; it creates/writes nothing.
export async function loadCurrentTankRows(tanks, currentUser, history = {}, client = supabase) {
  const sensor = [], ammonia = [];
  if (!client || !currentUser?.id) return { sensor, ammonia };
  const read = async (tank, table, fallback) => {
    const id = tank.id || tank.tank_id || tank.uuid;
    if (!id) return fallback();
    try {
      let query = client.from(table).select("*").eq(COLUMNS.TANK_ID, id);
      if (currentUser?.id && !currentUser.isAdmin) query = query.eq(COLUMNS.USER_ID, currentUser.id);
      const { data, error } = await query.order(COLUMNS.CREATED_AT, { ascending: false, nullsFirst: false }).limit(1);
      if (error) throw error;
      return data?.find(row => recordMatchesMonitoringTank(row, tank)) || null;
    } catch (error) {
      logDiagnostic(`Could not load latest ${table} event; using available history`, error);
      return fallback();
    }
  };
  // Bound concurrent requests without imposing a time limit on scan validity.
  for (let offset = 0; offset < tanks.length; offset += 4) {
    const rows = await Promise.all(tanks.slice(offset, offset + 4).map(async tank => {
      const [water, scan] = await Promise.all([
        read(tank, TABLES.SENSOR_READINGS, () => (history.sensor || []).filter(row => recordMatchesMonitoringTank(row, tank))
          .sort((a, b) => new Date(getMonitoringDate(b) || 0) - new Date(getMonitoringDate(a) || 0))[0] || null),
        read(tank, TABLES.AMMONIA_READINGS, () => getLatestAmmoniaForTank(tank, history.ammonia || [])),
      ]);
      return { water, scan };
    }));
    for (const { water, scan } of rows) {
      if (water) sensor.push(water);
      if (scan) ammonia.push(scan);
    }
  }
  return { sensor, ammonia };
}
