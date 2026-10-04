import { AlertCircle, AlertTriangle, CheckCircle2, Database } from "lucide-react";
import { getSafetyStatusLabel, normalizeSafetySeverity } from "../utils/statusHelpers";
import "../styles/safetyStatus.css";

export function SafetyIcon({ severity, size = 16 }) {
  const icons = { normal: CheckCircle2, warning: AlertTriangle, critical: AlertCircle, "no-data": Database };
  const Icon = icons[normalizeSafetySeverity(severity)];
  return <Icon size={size} aria-hidden="true" />;
}

export default function SafetyBadge({ severity, className = "", emptyLabel = "No Data" }) {
  const level = normalizeSafetySeverity(severity);
  return (
    <b className={`safety-status ${className} ${level}`}>
      <SafetyIcon severity={level} size={14} />
      {level === "no-data" ? emptyLabel : getSafetyStatusLabel(level)}
    </b>
  );
}
