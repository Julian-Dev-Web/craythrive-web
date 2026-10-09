import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { normalizeThresholds } from "../utils/thresholdEvaluation";
import { useSearchParams } from "react-router-dom";
import { applyTankThresholds, cacheThresholdBundle, fetchOwnedThresholdTanks, fetchThresholdRows,
  suggestionPatch, tankThresholdName, thresholdBundle, thresholdChanges } from "../services/tankThresholdService";
import { logDiagnostic } from "../utils/securityDiagnostics";
import useThresholdRefresh from "./useThresholdRefresh";

export default function useTankThresholdSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tanks, setTanks] = useState([]);
  const [rows, setRows] = useState([]);
  const [userId, setUserId] = useState(null);
  const [selectedTankId, selectTank] = useState(() => searchParams.get("tank") || "");
  const [draft, setDraft] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [syncMode, setSyncMode] = useState("local");
  const busy = useRef(false);
  const loadVersion = useRef(0);
  const row = rows.find(item => item.tank_id === selectedTankId);
  const selectedTank = tanks.find(tank => tank.id === selectedTankId);
  const baseline = useMemo(() => normalizeThresholds(rows.find(item => item.tank_id === selectedTankId)
    || rows.find(item => !item.tank_id)), [rows, selectedTankId]);
  const thresholds = draft || baseline;
  const setThresholds = update => setDraft(current => typeof update === "function" ? update(current || baseline) : update);
  const setSelectedTankId = id => {
    selectTank(id); setDraft(null);
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("tank", id); return next; }, { replace: true });
    // Mobile can apply while this editor is open. Tank switches read the
    // canonical database rows again instead of relying on the last bundle.
    void load();
  };
  const isDirty = useMemo(() => Object.keys(thresholdChanges(baseline, thresholds)).length > 0, [baseline, thresholds]);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      if (!isSupabaseConfigured || !supabase) throw new Error("Online settings unavailable");
      const { data, error } = await supabase.auth.getSession();
      if (error || !data?.session?.user?.id) throw new Error("Sign in to configure your tanks.");
      const id = data.session.user.id;
      const [owned, saved] = await Promise.all([fetchOwnedThresholdTanks(supabase, id), fetchThresholdRows(supabase, id)]);
      if (version !== loadVersion.current) return;
      setUserId(id); setTanks(owned); setRows(saved); setSyncMode("online");
      selectTank(current => owned.some(tank => tank.id === current) ? current : owned[0]?.id || "");
    } catch (error) {
      if (version !== loadVersion.current) return;
      logDiagnostic("Tank threshold load failed", error);
      setMessage({ tone: "warning", text: "Could not load tank settings. Reconnect and retry before applying changes." });
    } finally { if (version === loadVersion.current) setIsLoading(false); }
  }, []);
  useThresholdRefresh(load);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load]);

  async function apply(scope = "single_tank", source = "manual") {
    if (busy.current || !selectedTank || !userId) return;
    busy.current = true; setIsSaving(true); setMessage(null);
    try {
      const patch = source === "ai_recommendation" ? suggestionPatch(row?.pending_ai_suggestion)
        : scope === "all_tanks" ? normalizeThresholds(thresholds) : thresholdChanges(baseline, thresholds);
      const result = await applyTankThresholds(supabase, { userId, tankId: selectedTankId, patch, scope, source });
      if (!result.affected) { setMessage({ tone: "info", text: "No threshold values changed. No activity was recorded." }); return; }
      // Refetch authoritative settings; publish only after the transaction succeeds.
      ++loadVersion.current;
      const saved = await fetchThresholdRows(supabase, userId);
      setRows(saved); setDraft(null); cacheThresholdBundle(userId, thresholdBundle(saved), true);
      setMessage({ tone: "success", text: result.changed === 0 ? "Threshold values are unchanged. No activity was recorded."
        : scope === "all_tanks" ? `Threshold settings updated for ${result.affected} tanks.`
        : `Threshold settings updated for ${tankThresholdName(selectedTank)}.${source === "ai_recommendation" ? " AI recommendation accepted by user." : ""}` });
    } catch (error) {
      logDiagnostic("Tank threshold apply failed", error);
      setMessage({ tone: "warning", text: ["PGRST202", "42883"].includes(error?.code)
        ? "Tank threshold setup requires the database migration. Your changes have not been applied."
        : "Could not apply threshold settings. Refresh to check the saved values, then retry." });
    } finally { busy.current = false; setIsSaving(false); }
  }

  async function dismissSuggestion() {
    if (busy.current || !row?.id) return;
    busy.current = true; setIsSaving(true);
    try {
      const { error } = await supabase.from("tank_threshold_settings").update({ pending_ai_suggestion: null, pending_ai_suggested_at: null })
        .eq("user_id", userId).eq("tank_id", selectedTankId).eq("id", row.id);
      if (error) throw error;
      setRows(await fetchThresholdRows(supabase, userId));
      setMessage({ tone: "info", text: "Recommendation dismissed. Your thresholds were not changed." });
    } catch (error) {
      logDiagnostic("Threshold recommendation dismissal failed", error);
      setMessage({ tone: "warning", text: "Could not dismiss the recommendation. Please retry." });
    } finally { busy.current = false; setIsSaving(false); }
  }

  return { tanks, selectedTankId, setSelectedTankId, selectedTank, thresholds, baseline, setThresholds, isLoading, isSaving,
    message, setMessage, syncMode, isDirty, apply, load, pendingSuggestion: row?.pending_ai_suggestion, dismissSuggestion };
}
