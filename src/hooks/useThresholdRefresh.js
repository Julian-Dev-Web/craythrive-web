import { useEffect } from "react";
import { THRESHOLDS_CHANGED } from "../services/tankThresholdService";

// Refetch after returning from mobile as well as local/cross-tab Web saves.
export default function useThresholdRefresh(refresh) {
  useEffect(() => {
    const storage = event => { if (event.key?.startsWith("craythrive:tank-thresholds:")) refresh(); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener(THRESHOLDS_CHANGED, refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener(THRESHOLDS_CHANGED, refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
}
