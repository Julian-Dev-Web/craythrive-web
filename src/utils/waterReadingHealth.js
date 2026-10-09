// Firmware measurement health is separate from physical water-depth severity.
// Preserve carried values for display, never present them as fresh samples.
export function parseWaterMetadata(rawPayload) {
  if (typeof rawPayload === "string") {
    try { rawPayload = JSON.parse(rawPayload); } catch { return {}; }
  }
  return rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload) ? rawPayload : {};
}

export function getWaterReadingHealth(waterStatus, rawPayload) {
  const metadata = parseWaterMetadata(rawPayload);
  const code = String(waterStatus || "").trim().toUpperCase().replaceAll(" ", "_");
  const reportedHealth = String(metadata.sensor_health?.water_level?.health || "").toUpperCase();
  const age = metadata.water_last_good_age_ms;
  const lastGoodAgeMs = (typeof age === "number" || (typeof age === "string" && age.trim() !== ""))
    && Number.isFinite(Number(age)) && Number(age) >= 0 ? Number(age) : null;
  let health = "fresh"; // Legacy uploads have no provenance fields.
  if (code === "SENSOR_ERROR" || reportedHealth === "ERROR") health = "error";
  else if (["NO_READING", "NO_DATA", "WAITING"].includes(code)) health = "waiting";
  else if (code === "SENSOR_STALE" || metadata.water_value_source === "last_good"
    || metadata.water_measurement_fresh === false || metadata.water_measurement_fresh === "false") health = "stale";
  return { health, measurementFresh: health === "fresh", lastGoodAgeMs,
    valueSource: health === "stale" ? "last_good" : health === "fresh" ? "fresh" : "unavailable" };
}

export function getWaterHealthLabel(parameter) {
  if (!parameter || parameter.health === "no-data") return "No Data";
  if (parameter?.health === "error") return "Sensor Error";
  if (parameter?.health === "waiting") return "Waiting";
  if (parameter?.health === "stale") return "Waiting for fresh reading";
  return "Fresh";
}
