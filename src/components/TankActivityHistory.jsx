import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, HelpCircle, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import useThresholdRefresh from '../hooks/useThresholdRefresh';
import { loadTankActivity } from '../services/tankActivityService';
import { ACTIVITY_CATEGORIES } from '../../supabase/functions/_shared/tankActivity.js';
import SafetyBadge from './SafetyBadge';
import '../styles/tankActivity.css';

const PER_PAGE = 10;
const icons = { Completed: CheckCircle2, Cancelled: Clock3, Rechecking: RefreshCw, 'Executed – Rechecking': RefreshCw, 'Pending Verification': Clock3, 'In Progress': Activity, Blocked: AlertTriangle, Requested: Clock3, Started: Activity, Skipped: Clock3, Rejected: AlertTriangle, Failed: XCircle };

export default function TankActivityHistory({ tankId }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState({ status: 'loading' });
  const version = useRef(0);
  const pending = useRef(null);
  const id = useId();
  const scope = JSON.stringify([tankId, fromDate, toDate]);
  const invalidate = useCallback(() => {
    ++version.current;
    pending.current?.controller.abort();
    pending.current = null;
  }, []);
  const reload = useCallback(async (recheckAutomation = false) => {
    if (pending.current?.scope === scope) return;
    const request = ++version.current;
    pending.current?.controller.abort();
    const controller = new AbortController();
    pending.current = { scope, controller };
    const timeout = setTimeout(() => controller.abort(), 15000);
    // Retain the verified snapshot while refreshing this same tank/date scope.
    setLoaded(previous => previous.status === 'ready' && previous.scope === scope
      ? { ...previous, refreshing: true, error: null } : { status: 'loading', scope });
    try {
      const interrupted = new Promise((_, reject) => controller.signal.addEventListener('abort',
        () => reject(new Error('Activity request timed out or was interrupted. Reconnect and retry.')), { once: true }));
      const result = await Promise.race([loadTankActivity(supabase, { tankId, fromDate, toDate, signal: controller.signal,
        recheckAutomation: recheckAutomation === true }), interrupted]);
      if (version.current === request) setLoaded({ status: 'ready', scope, ...result });
    } catch (error) {
      if (version.current === request) setLoaded(previous => previous.status === 'ready' && previous.scope === scope
        ? { ...previous, refreshing: false, error: error.message } : { status: 'error', scope, error: error.message });
    } finally {
      clearTimeout(timeout);
      if (pending.current?.controller === controller) pending.current = null;
    }
  }, [tankId, fromDate, toDate, scope]);
  const backgroundReload = useCallback(() => {
    if (document.visibilityState === 'visible') void reload();
  }, [reload]);
  useThresholdRefresh(backgroundReload);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void reload(); });
    const interval = setInterval(backgroundReload, 30000);
    return () => { active = false; invalidate(); clearInterval(interval); };
  }, [reload, backgroundReload, invalidate]);
  const current = loaded.scope === scope ? loaded : { status: 'loading' };
  const events = current.status === 'ready' ? current.events.filter(event => category === 'all' || event.category === category) : [];
  const pages = Math.max(1, Math.ceil(events.length / PER_PAGE));
  const currentPage = Math.min(page, pages);
  return <section className="modern-tank-detail-panel tank-activity" aria-label="Tank activity history">
    <div className="modern-panel-heading"><div><p className="dashboard-eyebrow">Activity</p><h3>Tank activity history</h3></div>
      <button type="button" onClick={() => reload(true)} aria-label="Refresh activity" aria-busy={current.status === 'loading' || !!current.refreshing}
        disabled={current.status === 'loading' || current.refreshing}><RefreshCw size={18} /></button></div>
    <p className="tank-activity-note">Latest recorded events first · Asia/Manila. Automatic water completion means the actuator reported a confirmed water-level effect. Delivered water volume and feed delivery are not measured.</p>
    <div className="tank-activity-filters">
      <div><label htmlFor={`${id}-type`}>Activity type</label><select id={`${id}-type`} value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}>
        <option value="all">All activity</option>{Object.entries(ACTIVITY_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></div>
      <label htmlFor={`${id}-from`}>From date<input id={`${id}-from`} type="date" value={fromDate} onChange={event => { invalidate(); setPage(1); setFromDate(event.target.value); }} /></label>
      <label htmlFor={`${id}-to`}>To date<input id={`${id}-to`} type="date" value={toDate} onChange={event => { invalidate(); setPage(1); setToDate(event.target.value); }} /></label>
    </div>
    {current.error && <div role="alert">
      {current.status === 'ready' && <p>Showing previously loaded activity. It could not be updated.</p>}
      <p>{current.error}</p><button type="button" onClick={() => reload(true)} disabled={current.refreshing}>Retry activity</button>
    </div>}
    {current.status === 'loading' ? <p role="status"><Loader2 size={16} /> Loading verified activity…</p>
      : current.status === 'error' ? null
      : <>
        {current.notices.length > 0 && <div className="tank-activity-notices" role="status">{current.notices.map(notice => <p key={notice}>{notice}</p>)}</div>}
        {!events.length ? <p role="status">No recorded activity matches these filters. Missing history does not prove that no device action occurred.</p>
          : <ol className="tank-activity-timeline">{events.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE).map(event => {
            const Icon = icons[event.outcome] || HelpCircle;
            return <li key={event.id} data-activity-id={event.id}>
              <article>
                <div className="tank-activity-heading"><h4>{event.title}</h4>
                  {event.outcome && <span className={`tank-activity-outcome outcome-${event.outcomeTone || event.outcome.split(' ')[0].toLowerCase()}`}><Icon size={14} aria-hidden="true" />{event.outcome}</span>}
                  {event.severity !== 'no-data' && <SafetyBadge severity={event.severity} />}</div>
                <p className="tank-activity-date">{event.tankName} · <time dateTime={event.timestamp || undefined}>{event.timestampLabel}</time> (Asia/Manila)</p>
                <p className="tank-activity-note">{ACTIVITY_CATEGORIES[event.category]}</p>
                {event.outcomeTone && event.result && <p><b>Result:</b> <span>{event.result}</span></p>}
                {event.reason && <p><b>Recorded reason:</b> <span>{event.reason}</span></p>}
                {event.reading && <p><b>Recorded reading:</b> {event.reading}</p>}
                {event.threshold && <p><b>Recorded limit:</b> {event.threshold}</p>}
                {event.category === 'sensor' && !event.threshold && <p className="tank-activity-note">The event’s threshold was not saved. Current settings are not substituted.</p>}
                {event.action && <p><b>Action:</b> {event.action}</p>}
                {event.category === 'feeding' && <p><b>Dispense cycles:</b> {event.dispenseCycles ?? 'Not recorded'}</p>}
                {event.executionSource && <p><b>Source:</b> {event.executionSource}</p>}
                {!event.outcomeTone && event.result && <p><b>Result:</b> <span>{event.result}</span></p>}
                {event.context?.map(item => <p key={item.label}><b>{item.label === 'duration seconds' ? 'Recorded duration' : item.label}:</b> {item.value}{item.label === 'duration seconds' ? Number(item.value) === 1 ? ' second' : ' seconds' : ''}</p>)}
                {event.recommendation && <p><b>{event.recommendationLabel}:</b> {event.recommendation}</p>}
              </article>
            </li>;
          })}</ol>}
        {pages > 1 && <nav className="tank-activity-pagination" aria-label="Activity pages">
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage} of {pages}</span><button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
        </nav>}
      </>}
  </section>;
}
