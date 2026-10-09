import { DEFAULT_THRESHOLDS, thresholdBundle } from "../../supabase/functions/_shared/thresholdResolution.js";
export { thresholdBundle };

export const THRESHOLDS_CHANGED = "craythrive:thresholds-changed";
const cacheKey = userId => `craythrive:tank-thresholds:${userId}`;
export const tankThresholdName = tank => tank?.tank_name || tank?.name || "Tank";


export function readThresholdCache(userId) {
  try { return JSON.parse(localStorage.getItem(cacheKey(userId))) || thresholdBundle(); }
  catch { return thresholdBundle(); }
}

export function cacheThresholdBundle(userId, bundle, notify = false) {
  try { localStorage.setItem(cacheKey(userId), JSON.stringify(bundle)); } catch { /* Online data still usable. */ }
  if (notify && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THRESHOLDS_CHANGED, { detail: { userId } }));
}

export async function fetchThresholdRows(client, userId) {
  const response = await client.rpc("get_tank_threshold_settings");
  let data = response.data;
  if (response.error) {
    if (!["PGRST202", "42883"].includes(response.error.code)) throw response.error;
    // Preserve pre-migration reads; an Apply still fails if its RPC is absent.
    const legacy = await client.from("threshold_settings").select("*").eq("user_id", userId);
    if (legacy.error) throw legacy.error;
    data = legacy.data || [];
  }
  if (!Array.isArray(data)) throw new Error("Invalid tank threshold response.");
  const rows = data.filter(row => row.user_id === userId);
  cacheThresholdBundle(userId, thresholdBundle(rows));
  return rows;
}

export async function fetchOwnedThresholdTanks(client, userId) {
  const { data, error } = await client.from("tanks").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter(tank => tank.user_id === userId);
}

export function thresholdChanges(baseline, draft) {
  return Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).filter(key => Number(baseline[key]) !== Number(draft[key]))
    .map(key => [key, Number(draft[key])]));
}

export function suggestionPatch(suggestion) {
  if (!suggestion || typeof suggestion !== "object") throw new Error("No pending AI recommendation for this tank.");
  const parameter = String(suggestion.parameter || "").toLowerCase().replaceAll("_", "");
  const min = suggestion.suggested_min ?? suggestion.suggested?.min;
  const max = suggestion.suggested_max ?? suggestion.suggested?.max;
  const value = suggestion.suggested_value ?? suggestion.suggested?.value
    ?? (typeof suggestion.suggested === "number" ? suggestion.suggested : undefined) ?? min ?? max;
  const fields = parameter === "temperature" ? { temperatureMin: min, temperatureMax: max }
    : parameter === "ph" ? { phMin: min, phMax: max }
    : ["waterlevel", "waterlevelmin", "waterdepth"].includes(parameter) ? { waterLevelMin: value }
    : ["turbidity", "turbiditymax"].includes(parameter) ? { turbidityMax: value }
    : ["ammonia", "ammoniamax"].includes(parameter) ? { ammoniaMax: suggestion.suggested_value ?? suggestion.suggested?.value ?? max ?? min ?? value } : {};
  if (!Object.keys(fields).length || Object.values(fields).some(v => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error("The AI threshold recommendation is incomplete.");
  }
  return fields;
}

export async function applyTankThresholds(client, { userId, tankId, patch, scope = "single_tank", source = "manual" }) {
  if (!userId || !tankId) throw new Error("Select one of your tanks before applying thresholds.");
  if (source === "manual" && !Object.keys(patch).length) return { affected: 0, changed: 0 };
  const { data, error } = await client.rpc("apply_tank_thresholds", { p_tank_id: tankId, p_patch: patch, p_scope: scope, p_source: source });
  if (error) throw error;
  return data;
}
