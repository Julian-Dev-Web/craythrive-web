// Map evaluator labels to the existing UI tones.
export function getSafetyLabelSeverity(statuses) {
  if (statuses.some(label => ["Below Active Min", "Above Active Max", "Needs Attention"].includes(label))) return "critical";
  if (statuses.every(label => ["No Reading", "No Scan Yet", ""].includes(label))) return "no-data";
  if (statuses.every(label => ["Within Active Range", "Clear", "No Reading", "No Scan Yet", ""].includes(label))) return "normal";
  return null;
}

export function getSafetySeverity(safety) {
  if (!safety) return "no-data";
  const severities = Object.values(safety.parameters || {})
    .map(parameter => normalizeSafetySeverity(parameter.severity));
  if (severities.includes("critical")) return "critical";
  if (severities.includes("warning")) return "warning";
  // A listed issue must never appear as Normal.
  if (safety.issues?.length) return "critical";
  if (!safety.hasData) return "no-data";
  return safety.isSafe ? "normal" : "critical";
}

export function normalizeSafetySeverity(severity) {
  switch (String(severity || "").toLowerCase()) {
    case "safe":
    case "success":
    case "normal": return "normal";
    case "warning": return "warning";
    case "critical":
    case "danger":
    case "unsafe": return "critical";
    default: return "no-data";
  }
}

export function getSafetyStatusLabel(severity) {
  const labels = { normal: "Normal", warning: "Warning", critical: "Critical", "no-data": "No Data" };
  return labels[normalizeSafetySeverity(severity)];
}

export function getParameterExplanation(parameter, name) {
  if (!parameter) return "";
  const severity = normalizeSafetySeverity(parameter.severity);
  if (severity === "normal") return "";
  if (parameter.label === "Below Active Min") return name + " is below the configured minimum";
  if (parameter.label === "Above Active Max") return name + " is above the configured maximum";
  if (parameter.label === "Needs Attention") return "Water clarity is below the configured clear-water range";
  if (severity === "warning") return name + " is approaching or outside the preferred range";
  return parameter.label || "";
}
