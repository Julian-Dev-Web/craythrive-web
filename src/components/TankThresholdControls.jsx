import { useEffect, useRef, useState } from "react";
import { Settings, Sparkles } from "lucide-react";
import { suggestionPatch, tankThresholdName } from "../services/tankThresholdService";

const names = { temperatureMin: "Temperature Minimum", temperatureMax: "Temperature Maximum", phMin: "pH Minimum",
  phMax: "pH Maximum", turbidityMax: "Water Clarity Minimum", waterLevelMin: "Water Level Minimum", ammoniaMax: "Ammonia Maximum" };

export default function TankThresholdControls({ editor, valid }) {
  const dialog = useRef(null);
  const [confirmSource, setConfirmSource] = useState(null);
  let recommendation = {};
  try { recommendation = suggestionPatch(editor.pendingSuggestion); } catch { /* Incomplete recommendations cannot be applied. */ }
  const hasRecommendation = Object.keys(recommendation).length > 0;
  useEffect(() => {
    if (confirmSource) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirmSource]);
  return <>
    <div className="cray-tank-threshold-controls">
      <label htmlFor="threshold-tank">Tank</label>
      <select id="threshold-tank" value={editor.selectedTankId} disabled={editor.isSaving}
        onChange={event => { editor.setSelectedTankId(event.target.value); editor.setMessage(null); }}>
        {!editor.tanks.length && <option value="">No tanks available</option>}
        {editor.tanks.map(tank => <option key={tank.id} value={tank.id}>{tankThresholdName(tank)}</option>)}
      </select>
      <button type="button" className="cray-settings-secondary-button" disabled={!valid || editor.isSaving || !editor.selectedTank}
        onClick={() => setConfirmSource("manual")}><Settings size={16} />Apply to All My Tanks</button>
      <button type="button" className="cray-settings-secondary-button" disabled={editor.isSaving}
        onClick={editor.load}>Reload Tank Settings</button>
    </div>
    {!editor.tanks.length && <p>Add or select an owned tank before applying threshold settings.</p>}
    {editor.pendingSuggestion && <section className="cray-settings-panel cray-threshold-recommendation">
      <h3><Sparkles size={18} /> AI threshold recommendation</h3>
      <p>{editor.pendingSuggestion.reason || "Review this recommendation before applying it."}</p>
      {Object.entries(recommendation).map(([key, value]) => <p key={key}>{names[key]}: {editor.baseline[key]} → {value}</p>)}
      {!hasRecommendation && <p>This recommendation is incomplete and cannot be applied.</p>}
      <p>Your saved thresholds stay unchanged until you click Apply. The activity will record your acceptance.</p>
      <div className="cray-settings-actions">
        <button type="button" className="dashboard-primary-button" disabled={editor.isSaving || !hasRecommendation}
          onClick={() => editor.apply("single_tank", "ai_recommendation")}>Apply Recommendation to This Tank</button>
        <button type="button" className="cray-settings-secondary-button" disabled={editor.isSaving || !hasRecommendation}
          onClick={() => setConfirmSource("ai_recommendation")}>Apply Recommendation to All My Tanks</button>
        <button type="button" className="cray-settings-secondary-button" disabled={editor.isSaving}
          onClick={editor.dismissSuggestion}>Dismiss Recommendation</button>
      </div>
    </section>}
    <dialog ref={dialog} className="cray-threshold-confirm" aria-labelledby="threshold-confirm-title"
      onCancel={event => { if (editor.isSaving) event.preventDefault(); else setConfirmSource(null); }}
      onClose={() => setConfirmSource(null)}>
      <h3 id="threshold-confirm-title">Apply these threshold settings to all {editor.tanks.length} tanks?</h3>
      <p>This will replace the current threshold settings for each tank you own.</p>
      {confirmSource === "ai_recommendation" && <p>The latest saved settings for this tank, including the accepted recommendation, will be used.</p>}
      <div className="cray-settings-actions">
        <button type="button" className="cray-settings-secondary-button" disabled={editor.isSaving}
          onClick={() => setConfirmSource(null)}>Cancel</button>
        <button type="button" className="dashboard-primary-button" disabled={editor.isSaving}
          onClick={async () => { await editor.apply("all_tanks", confirmSource); setConfirmSource(null); }}>
          {editor.isSaving ? "Applying…" : "Confirm Apply to All Tanks"}
        </button>
      </div>
    </dialog>
  </>;
}
