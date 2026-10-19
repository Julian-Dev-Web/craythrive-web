import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { loadFeedTestState, queueFeedLockReset } from '../services/feedTestService';
import { actuatorControlError } from '../services/actuatorControlService';
import { actuatorCommandErrorMessage } from '../services/actuatorCommandService.js';
import { isCommandActive } from '../../supabase/functions/_shared/actuatorCommandLifecycle.js';

export default function FeedingTestSettings({ tank }) {
  const [resource, setResource] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const busy = useRef(false);
  const commandId = useRef(null);
  const scope = tank?.id;
  const current = resource?.tankId === scope ? resource : null;
  const active = current?.data.active_commands.length > 0;
  const command = current?.data.command?.command_type === 'RESET_FEED_LOCK' ? current.data.command : null;
  const pending = isCommandActive(command);
  const locked = !current?.verified || current.data.emergency_stop_active || active || submitting;
  const reload = useCallback(async () => {
    if (busy.current) return;
    const version = ++request.current;
    try {
      const state = await loadFeedTestState(supabase, tank, commandId.current);
      if (request.current !== version) return;
      setResource({ ...state, tankId: scope, verified: true });
      if (state.data.command?.command_type === 'RESET_FEED_LOCK' && !isCommandActive(state.data.command)) {
        setMessage(state.data.command.command_status === 'done' ? 'Feed test reset. You may use Feed Now again.'
          : state.data.command.result_message || 'The feed test reset is unconfirmed.');
      }
    } catch (error) {
      if (request.current === version) setResource(previous => ({ ...previous, tankId: scope, verified: false,
        data: previous?.tankId === scope ? previous.data : { active_commands: [] }, error: error.message?.startsWith('Connect a paired') ? error.message : actuatorControlError(error) }));
    }
  }, [tank, scope]);
  useEffect(() => {
    let mounted = true; const versionRef = request;
    commandId.current = null;
    Promise.resolve().then(() => { if (mounted) void reload(); });
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus', visible); window.addEventListener('online', visible);
    return () => { mounted = false; versionRef.current++; window.removeEventListener('focus', visible); window.removeEventListener('online', visible); };
  }, [reload]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 1500);
    return () => clearInterval(timer);
  }, [active, reload]);
  async function reset() {
    if (busy.current || locked || !window.confirm("Allow another feeding test today?\nThis clears only today's actuator feed lock. Water and feeding safety checks will still be applied.")) return;
    busy.current = true; setSubmitting(true); setMessage('Resetting feed test lock...');
    const version = ++request.current;
    try {
      const command = await queueFeedLockReset(supabase, current.scope);
      if (request.current !== version) return;
      commandId.current = command.id;
      setResource(previous => ({ ...previous, data: { ...previous.data, command, active_commands: [command] } }));
    } catch (error) {
      if (request.current === version) { setMessage(actuatorCommandErrorMessage(error, 'The reset request could not be confirmed. Refresh actuator state before retrying.')); setResource(previous => ({ ...previous, verified: false })); }
    } finally { busy.current = false; setSubmitting(false); }
  }
  return <section className="automatic-feeding-card" aria-label="Feeding test maintenance">
    <div className="automatic-feeding-heading"><h3>Feeding Test</h3><button type="button" aria-label="Refresh feed test state" onClick={reload} disabled={submitting}><RefreshCw size={17} /></button></div>
    <p>Allows another manual feeding test today by clearing the actuator's local daily feed lock. Normal sensor safety rules still apply.</p>
    {current?.error && <p role="alert"><AlertTriangle size={16} /> {current.error}</p>}
    {current?.data.emergency_stop_active && <p>Emergency Stop is active. Resume controls explicitly in Tank Details before testing.</p>}
    {active && !pending && <p>Another actuator action is pending or running. Wait for it to finish before resetting the feed lock.</p>}
    <button type="button" className="automatic-feeding-save" disabled={locked} onClick={reset}>
      {pending || submitting ? <Loader2 size={17} className="spin-icon" /> : <Info size={17} />}
      {pending || submitting ? 'Resetting feed test lock...' : 'Allow Another Feed Test Today'}
    </button>
    {message && <p role="status">{message}</p>}
    <p className="manual-feed-note">This sends a maintenance command only. Feed history stays intact. The actuator must confirm the reset before it is shown as completed.</p>
  </section>;
}
