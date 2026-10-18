import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Clock3, Loader2, RefreshCw, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DispenseCycleSelector } from './ManualFeedOptions';
import { feedingTimeInput, feedingTimeLabel, nextFeedingSchedule, parseFeedingTime, validFeedingSchedule } from '../../supabase/functions/_shared/feedingSchedule.js';
import { dispenseCycleLabel, recordedDispenseCycles } from '../../supabase/functions/_shared/feederControl.js';
import { getRecordedActionOutcome } from '../../supabase/functions/_shared/tankActivity.js';
import { formatPhilippineDateTime, philippineDateKey } from '../utils/philippineTime';
import { FEEDING_SCHEDULE_CHANGED, feedingScheduleError, loadFeedingSchedule, saveFeedingSchedule } from '../services/feedingScheduleService';
import '../styles/automaticFeeding.css';

export default function AutomaticFeedingSettings({ tank, nowMs = null, lastFeed = null }) {
  const id = useId();
  const tankId = tank?.id;
  const [resource, setResource] = useState({ status: 'loading' });
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(null);
  const version = useRef(0);
  const run = useCallback(async (operation, savingRequest = false) => {
    if (pending.current || !tankId) return;
    const request = ++version.current;
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    if (savingRequest) setSaving(true);
    try {
      const interrupted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Interrupted schedule request')), { once: true }));
      const snapshot = await Promise.race([operation(controller.signal), interrupted]);
      if (version.current !== request) return;
      setResource({ status: 'ready', snapshot, verified: true });
      if (savingRequest) { setDraft(null); setMessage('Automatic feeding schedule updated.'); }
    } catch (error) {
      if (version.current === request) { setResource(previous => ({ ...previous, status: 'error', verified: false, error: feedingScheduleError(error) })); setMessage(''); }
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) pending.current = null;
      if (version.current === request && savingRequest) setSaving(false);
    }
  }, [tankId]);
  const reload = useCallback(() => { void run(signal => loadFeedingSchedule(supabase, tankId, signal)); }, [run, tankId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) reload(); });
    const refresh = event => {
      if (document.visibilityState === 'visible' && (!event.detail?.tankId || event.detail.tankId === tankId)) reload();
    };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh); window.addEventListener(FEEDING_SCHEDULE_CHANGED, refresh);
    const requestVersion = version;
    const pendingRequest = pending;
    return () => {
      active = false; requestVersion.current++; pendingRequest.current?.abort(); pendingRequest.current = null;
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener(FEEDING_SCHEDULE_CHANGED, refresh);
    };
  }, [reload, tankId]);
  const snapshot = resource.snapshot;
  const settings = draft || snapshot?.settings;
  const patch = values => { setDraft(current => ({ ...(current || snapshot.settings), ...values })); setMessage(''); };
  const confirmedFeed = lastFeed?.tank_id === tankId && lastFeed.command_status === 'done' && getRecordedActionOutcome(lastFeed) === 'Completed' ? lastFeed : null;
  const completedToday = confirmedFeed && nowMs !== null && philippineDateKey(confirmedFeed.executed_at) === philippineDateKey(nowMs);
  const next = snapshot?.exists && resource.verified ? nextFeedingSchedule(snapshot.settings, nowMs, !!completedToday) : null;
  const lastCycles = confirmedFeed ? recordedDispenseCycles(confirmedFeed.command_value) : null;
  return <section className="automatic-feeding-card" aria-label="Automatic feeding schedule">
    <div className="automatic-feeding-heading"><div><p className="dashboard-eyebrow">Automation</p><h3><Clock3 size={19} aria-hidden="true" />Automatic Feeding</h3></div>
      <button type="button" aria-label="Reload feeding schedule" onClick={reload} disabled={saving}><RefreshCw size={17} /></button></div>
    {resource.status === 'loading' && <p role="status">Loading feeding schedule…</p>}
    {resource.error && <p role="alert">{resource.error}</p>}
    {settings && <>
      <label className="automatic-feeding-toggle" htmlFor={`${id}-enabled`}>
        <input id={`${id}-enabled`} type="checkbox" role="switch" checked={settings.auto_feeding_enabled} disabled={saving || !resource.verified}
          onChange={event => patch({ auto_feeding_enabled: event.target.checked })} />Enable Automatic Feeding
      </label>
      {!settings.auto_feeding_enabled && <p>Automatic feeding disabled{draft ? ' — save to apply' : ''}.</p>}
      <div className="automatic-feeding-time"><label htmlFor={`${id}-time`}>Feeding Time</label>
        <input id={`${id}-time`} type="time" step="60" value={feedingTimeInput(settings)} disabled={saving || !resource.verified || !settings.auto_feeding_enabled}
          onChange={event => patch(parseFeedingTime(event.target.value))} />
        <small>Philippine Time (UTC+8)</small></div>
      <div className="manual-feed-options"><DispenseCycleSelector label="Dispense Amount" cycles={settings.auto_feed_cycles}
        disabled={saving || !resource.verified || !settings.auto_feeding_enabled} onChange={cycles => patch({ auto_feed_cycles: cycles })} /></div>
      {snapshot.invalid && <p role="alert">Some saved feeding values are invalid. Review the displayed defaults before saving.</p>}
      {!snapshot.exists && <p className="manual-feed-note">Default schedule shown. Nothing is saved until you click Save Feeding Schedule.</p>}
      {!snapshot.can_save && <p>Connect an actuator to this tank before saving its first feeding schedule.</p>}
      {draft && <p className="manual-feed-note">You have unsaved feeding changes.</p>}
      {!validFeedingSchedule(settings) && <p role="alert">Choose a valid hour, minute and 1–3 dispense cycles.</p>}
      <button type="button" className="automatic-feeding-save" disabled={saving || !resource.verified || !snapshot.can_save || !validFeedingSchedule(settings)}
        onClick={() => { setMessage(''); void run(signal => saveFeedingSchedule(supabase, tankId, settings, signal), true); }}>
        {saving ? <Loader2 size={17} className="spin-icon" /> : <Save size={17} />} {saving ? 'Saving…' : 'Save Feeding Schedule'}</button>
      {message && <p role="status">{message}</p>}
      {snapshot.exists && <p className="automatic-feeding-summary">{resource.verified ? 'Saved daily schedule' : 'Previously loaded schedule'}: {snapshot.settings.auto_feeding_enabled
        ? `${feedingTimeLabel(snapshot.settings)} · ${dispenseCycleLabel(snapshot.settings.auto_feed_cycles)} · Enabled` : 'Disabled'} · Philippine Time</p>}
      {next && <p className="manual-feed-note">Next scheduled time: {formatPhilippineDateTime(next)} (Philippine Time). Actuator safety checks still apply.</p>}
      {confirmedFeed && <p className="manual-feed-note">Last confirmed feeding in command history: {formatPhilippineDateTime(confirmedFeed.executed_at)} · Completed{lastCycles !== null ? ` · ${dispenseCycleLabel(lastCycles)}` : ''}</p>}
    </>}
    <p className="manual-feed-note">Saving updates the schedule only. A compatible paired actuator runs feeding and applies its safety checks, even when the website is closed.</p>
  </section>;
}
