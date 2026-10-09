import { useEffect } from "react";
import { THRESHOLDS_CHANGED } from "../services/tankThresholdService";

// Same-tab saves and other-tab storage changes re-evaluate existing readings.
export default function useThresholdRefresh(refresh) {
  useEffect(() => {
    const storage = event => { if (event.key?.startsWith("craythrive:tank-thresholds:")) refresh(); };
    window.addEventListener(THRESHOLDS_CHANGED, refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(THRESHOLDS_CHANGED, refresh);
      window.removeEventListener("storage", storage);
    };
  }, [refresh]);
}
