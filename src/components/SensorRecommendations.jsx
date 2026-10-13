import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Lightbulb, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import useServerTime from '../hooks/useServerTime';
import useThresholdRefresh from '../hooks/useThresholdRefresh';
import { buildSensorRecommendations } from '../../supabase/functions/_shared/sensorRecommendations.js';
import { explainSensorRecommendations, loadTankRecommendationContext, recommendationInputs } from '../services/sensorRecommendationService';
import SafetyBadge from './SafetyBadge';
import '../styles/sensorRecommendations.css';
import { recommendationHistory, recommendationFingerprint, AI_HISTORY_RETENTION_MS } from '../services/recommendationHistory';
import { fetchServerTimestamp, getServerNowMs } from '../services/serverTimeService';
import { formatPhilippineDateTime } from '../utils/philippineTime';

function AIExplanation({ context, recommendations, verified, refreshing }) {
  const ownerId = context.tank.user_id, tankId = context.tank.id;
  const nowMs = useServerTime();
  const clockReady = Number.isFinite(nowMs);
  const fingerprint = recommendationFingerprint(context, recommendations);
  const [entries, setEntries] = useState(() => recommendationHistory.read(ownerId, tankId, getServerNowMs()));
  const [result, setResult] = useState({ loading: !!recommendationHistory.pending(ownerId, tankId) });
  const active = useRef(false);
  useEffect(() => {
    let mounted = true;
    active.current = true;
    const pending = recommendationHistory.pending(ownerId, tankId);
    Promise.resolve().then(() => {
      if (mounted && clockReady) setEntries(recommendationHistory.read(ownerId, tankId, getServerNowMs()));
    });
    if (pending) pending.then(saved => { if (mounted) { setEntries(saved); setResult({}); } },
      error => { if (mounted) setResult({ error: error.message }); });
    return () => { mounted = false; active.current = false; };
  }, [ownerId, tankId, clockReady]);
  const explain = async () => {
    if (result.loading) return;
    setResult({ loading: true });
    let clockDeadline;
    try {
      // Sample trusted time at the explicit request, not the previous render's
      // one-second clock tick (which can predate a just-arrived observation).
      const generationTime = Date.parse(await Promise.race([fetchServerTimestamp(), new Promise((_, reject) => {
        clockDeadline = setTimeout(() => reject(new Error('Server time could not be verified. Reconnect and retry.')), 15000);
      })]));
      clearTimeout(clockDeadline);
      const generationRecommendations = buildSensorRecommendations(recommendationInputs(context, generationTime));
      const saved = await recommendationHistory.run({ ownerId, tankId, fingerprint: recommendationFingerprint(context, generationRecommendations),
        generate: signal => explainSensorRecommendations(supabase, context, generationRecommendations, signal),
        timestamp: fetchServerTimestamp,
        verifyOwner: async () => {
          const { data, error } = await supabase.auth.getUser();
          return !error && data?.user?.id === ownerId;
        } });
      if (active.current) { setEntries(saved); setResult({}); }
    } catch (error) {
      if (active.current) setResult({ error: error.message });
    } finally { clearTimeout(clockDeadline); }
  };
  const latest = entries[0];
  const outdated = latest && (!verified || latest.fingerprint !== fingerprint || !clockReady
    || nowMs - Date.parse(latest.generatedAt) >= AI_HISTORY_RETENTION_MS);
  return <section className="sensor-recommendations-ai" aria-label="Optional AI Guide explanation">
    <button type="button" onClick={explain} disabled={result.loading || !verified || refreshing}>
      {result.loading ? <Loader2 size={16} className="sensor-recommendations-spin" /> : <Sparkles size={16} />}
      {result.loading ? 'Asking AI Guide…' : latest ? 'Refresh AI Recommendation' : 'Explain with AI Guide'}
    </button>
    <p>Optional explanation. Your evaluated statuses and equipment settings stay unchanged.</p>
    <p>Saved in this browser tab for up to 24 hours. Previous explanations are kept as history.</p>
    {result.error && <p role="alert">{result.error}</p>}
    {latest && <div className="sensor-recommendations-ai-answer" role="status">
      <strong>AI explanation</strong>
      <p className="sensor-recommendation-date">Last AI recommendation: <time dateTime={latest.generatedAt}>{formatPhilippineDateTime(latest.generatedAt)}</time> (Asia/Manila)</p>
      {outdated && <p className="sensor-recommendations-outdated">Outdated — readings, thresholds or verification have changed. Generate a fresh explanation before relying on this advice.</p>}
      {refreshing && <p>Checking current readings… Your previous explanation is kept below.</p>}
      <p>{latest.text}</p>
    </div>}
    {entries.length > 1 && <details className="sensor-recommendations-ai-history"><summary>Previous AI recommendations ({entries.length - 1})</summary>
      {entries.slice(1).map(entry => <article key={entry.id}><small>{formatPhilippineDateTime(entry.generatedAt)} (Asia/Manila) · Historical explanation</small><p>{entry.text}</p></article>)}
    </details>}
  </section>;
}

function RecommendationDialog({ tanks, initialTankId, revision, onDismiss }) {
  const [requestedId, setSelectedId] = useState(initialTankId || '');
  const selectedId = tanks.some(tank => tank.id === requestedId) ? requestedId
    : tanks.some(tank => tank.id === initialTankId) ? initialTankId : tanks[0]?.id || '';
  const [loaded, setLoaded] = useState({ status: 'loading' });
  const version = useRef(0);
  const inFlight = useRef(null);
  const previousRevision = useRef(revision);
  const dialog = useRef(null);
  const headingId = useId();
  const selectId = useId();
  const nowMs = useServerTime();
  const invalidate = useCallback(() => { ++version.current; }, []);
  const reload = useCallback(async () => {
    if (inFlight.current?.tankId === selectedId) { inFlight.current.queued = true; return; }
    const request = ++version.current;
    setLoaded(previous => previous.tankId === selectedId && previous.context
      ? { ...previous, status: 'ready', refreshing: true, error: null } : { status: 'loading', tankId: selectedId });
    if (!selectedId) return;
    const pending = { tankId: selectedId, queued: false };
    inFlight.current = pending;
    let deadline;
    try {
      const context = await Promise.race([loadTankRecommendationContext(supabase, selectedId), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Readings or thresholds could not be verified. Reconnect and retry.')), 15000);
      })]);
      if (request === version.current) setLoaded({ status: 'ready', tankId: selectedId, context });
    } catch (error) {
      if (request === version.current) setLoaded(previous => ({ status: 'error', tankId: selectedId,
        context: previous.tankId === selectedId ? previous.context : null, error: error.message }));
    } finally {
      clearTimeout(deadline);
      if (inFlight.current === pending) {
        inFlight.current = null;
        if (pending.queued && request === version.current) void reload();
      }
    }
  }, [selectedId]);
  useThresholdRefresh(reload);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void reload(); });
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 30000);
    return () => { active = false; invalidate(); clearInterval(interval); };
  }, [reload, invalidate]);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    const timer = setTimeout(reload, 200);
    return () => clearTimeout(timer);
  }, [revision, reload]);
  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    // Removing the dialog closes it. An explicit cleanup close would emit a
    // dismiss event during React StrictMode's development effect replay.
  }, []);
  const current = loaded.tankId === selectedId ? loaded.context : null;
  const recommendations = current ? buildSensorRecommendations(recommendationInputs(current, nowMs)) : [];
  const issues = recommendations.filter(item => ['critical', 'warning'].includes(item.severity));
  const unknown = recommendations.filter(item => item.severity === 'no-data');

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
        <button type="button" aria-label="Refresh recommendations" disabled={!selectedId || loaded.status === 'loading' || loaded.refreshing} onClick={reload}>
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
        </>}
      {current && <AIExplanation key={`${current.tank.user_id}:${current.tank.id}`} context={current}
        recommendations={recommendations} verified={loaded.status === 'ready'} refreshing={!!loaded.refreshing} />}
    </section>
  </dialog>;
}

export default function SensorRecommendations({ tanks, initialTankId, monitoring }) {
  const [open, setOpen] = useState(false);
  const revision = monitoring ? JSON.stringify({ rows: monitoring.rows, thresholds: monitoring.thresholds }) : '';
  return <>
    <div className="sensor-recommendations-dock">
      <button type="button" className="sensor-recommendations-launcher" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(true)}><Lightbulb size={18} />Recommendations</button>
    </div>
    {open && <RecommendationDialog tanks={tanks} initialTankId={initialTankId} revision={revision} onDismiss={() => setOpen(false)} />}
  </>;
}
