import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Lightbulb, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import useServerTime from '../hooks/useServerTime';
import useThresholdRefresh from '../hooks/useThresholdRefresh';
import { buildSensorRecommendations } from '../../supabase/functions/_shared/sensorRecommendations.js';
import { explainSensorRecommendations, loadTankRecommendationContext, recommendationInputs } from '../services/sensorRecommendationService';
import SafetyBadge from './SafetyBadge';
import '../styles/sensorRecommendations.css';

function AIExplanation({ context, recommendations }) {
  const [result, setResult] = useState({});
  const pending = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.abort(); };
  }, []);
  const explain = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setResult({ loading: true });
    try {
      const text = await explainSensorRecommendations(supabase, context, recommendations, controller.signal);
      if (mounted.current) setResult({ text });
    } catch (error) {
      if (mounted.current) setResult({ error: controller.signal.aborted ? 'AI Guide timed out. Please retry later.' : error.message });
    } finally {
      clearTimeout(timeout);
      pending.current = null;
    }
  };
  return <section className="sensor-recommendations-ai" aria-label="Optional AI Guide explanation">
    <button type="button" onClick={explain} disabled={result.loading}>
      {result.loading ? <Loader2 size={16} className="sensor-recommendations-spin" /> : <Sparkles size={16} />}
      {result.loading ? 'Asking AI Guide…' : 'Explain with AI Guide'}
    </button>
    <p>Optional explanation. Your evaluated statuses and equipment settings stay unchanged.</p>
    {result.error && <p role="alert">{result.error}</p>}
    {result.text && <div className="sensor-recommendations-ai-answer" role="status">
      <strong>AI explanation</strong><p>{result.text}</p>
    </div>}
  </section>;
}

function RecommendationDialog({ tanks, initialTankId, onDismiss }) {
  const [requestedId, setSelectedId] = useState(initialTankId || '');
  const selectedId = tanks.some(tank => tank.id === requestedId) ? requestedId
    : tanks.some(tank => tank.id === initialTankId) ? initialTankId : tanks[0]?.id || '';
  const [loaded, setLoaded] = useState({ status: 'loading' });
  const version = useRef(0);
  const dialog = useRef(null);
  const headingId = useId();
  const selectId = useId();
  const nowMs = useServerTime();
  const invalidate = useCallback(() => { ++version.current; }, []);
  const reload = useCallback(async () => {
    const request = ++version.current;
    setLoaded({ status: 'loading', tankId: selectedId });
    if (!selectedId) return;
    try {
      const context = await loadTankRecommendationContext(supabase, selectedId);
      if (request === version.current) setLoaded({ status: 'ready', tankId: selectedId, context });
    } catch (error) {
      if (request === version.current) setLoaded({ status: 'error', tankId: selectedId, error: error.message });
    }
  }, [selectedId]);
  useThresholdRefresh(reload);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void reload(); });
    const interval = setInterval(reload, 30000);
    return () => { active = false; invalidate(); clearInterval(interval); };
  }, [reload, invalidate]);
  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    // Removing the dialog closes it. An explicit cleanup close would emit a
    // dismiss event during React StrictMode's development effect replay.
  }, []);
  const current = loaded.tankId === selectedId && loaded.status === 'ready' ? loaded.context : null;
  const recommendations = current ? buildSensorRecommendations(recommendationInputs(current, nowMs)) : [];
  const issues = recommendations.filter(item => ['critical', 'warning'].includes(item.severity));
  const unknown = recommendations.filter(item => item.severity === 'no-data');
  const fingerprint = JSON.stringify(recommendations);

  return <dialog ref={dialog} className="sensor-recommendations-dialog" aria-labelledby={headingId}
    onClose={onDismiss} onClick={event => { if (event.target === event.currentTarget) dialog.current.close(); }}>
    <section className="sensor-recommendations-content">
      <header>
        <div><p>Tank monitoring</p><h2 id={headingId}>Recommendations</h2></div>
        <button type="button" className="sensor-recommendations-close" aria-label="Close recommendations" autoFocus
          onClick={() => dialog.current.close()}><X size={20} /></button>
      </header>
      <div className="sensor-recommendations-toolbar">
        <label htmlFor={selectId}>Tank</label>
        <select id={selectId} value={selectedId} onChange={event => {
          if (event.target.value !== selectedId) invalidate();
          // Persist an explicit choice even if it equals the current fallback.
          // A later Dashboard snapshot may change initialTankId.
          setSelectedId(event.target.value);
        }}>
          {!tanks.length && <option value="">No tanks available</option>}
          {tanks.map(tank => <option key={tank.id} value={tank.id}>{tank.name || tank.tank_name || tank.title || 'Tank'}</option>)}
        </select>
        <button type="button" aria-label="Refresh recommendations" disabled={!selectedId || loaded.status === 'loading'} onClick={reload}>
          <RefreshCw size={17} /></button>
      </div>
      <p className="sensor-recommendations-note">Uses saved safe limits and available device reports. Separate critical limits still need configuration. Confirm measurements before intervening.</p>
      {!selectedId ? <p role="status">No tanks available. Recommendations will appear when an owned tank is available.</p>
        : loaded.tankId !== selectedId || loaded.status === 'loading' ? <p role="status"><Loader2 size={16} /> Checking this tank’s readings and settings…</p>
        : loaded.status === 'error' ? <div role="alert"><p>{loaded.error}</p><button type="button" onClick={reload}>Retry recommendations</button></div>
        : <>
          {!issues.length && <p className="sensor-recommendations-empty" role="status">
            {unknown.length ? 'No verified current Warning or Critical readings. Complete the missing or fresh-reading checks below.'
              : 'No recommendations require attention. Continue routine monitoring.'}
          </p>}
          <div className="sensor-recommendations-list">
            {recommendations.map(item => <article className="sensor-recommendation" data-parameter={item.parameter} key={item.id}>
              <div className="sensor-recommendation-heading"><h3>{item.name}</h3>
                <SafetyBadge severity={item.severity} emptyLabel={item.status} /></div>
              <p className="sensor-recommendation-tank">{item.tankName}</p>
              <strong className="sensor-recommendation-value">{item.latestValue}</strong>
              <p>{item.safeRange}</p>
              <p className="sensor-recommendation-date">{item.measurementType === 'manual_scan' ? 'Manual scan' : 'Recorded'}: {item.timestampLabel} (Asia/Manila)</p>
              {item.measurementType === 'manual_scan' && item.value !== null && <p className="sensor-recommendation-note">Latest available manual result; current condition requires verification.</p>}
              <p><b>Why:</b> {item.reason}</p>
              <p><b>Suggested action:</b> {item.action}</p>
            </article>)}
          </div>
          {current && <AIExplanation key={fingerprint} context={current} recommendations={recommendations} />}
        </>}
    </section>
  </dialog>;
}

export default function SensorRecommendations({ tanks, initialTankId }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="sensor-recommendations-dock">
      <button type="button" className="sensor-recommendations-launcher" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(true)}><Lightbulb size={18} />Recommendations</button>
    </div>
    {open && <RecommendationDialog tanks={tanks} initialTankId={initialTankId} onDismiss={() => setOpen(false)} />}
  </>;
}
