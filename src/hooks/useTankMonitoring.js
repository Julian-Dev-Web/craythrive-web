import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadCurrentTankRows } from '../services/tankSnapshotService';
import { fetchThresholdRows, thresholdBundle, THRESHOLDS_CHANGED } from '../services/tankThresholdService';
import { getServerNowMs, syncServerTime } from '../services/serverTimeService';

const emptyRows = () => ({ sensor: [], ammonia: [], errors: [] });

// All monitoring screens use this read-only owner-scoped snapshot. Realtime
// events are invalidation signals, never unverified values merged into state.
export default function useTankMonitoring(tanks) {
  const scope = JSON.stringify(tanks.map(tank => ({ id: tank.id, user_id: tank.user_id }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const [state, setState] = useState({ scope: '', rows: emptyRows(), thresholds: null,
    userId: null, error: '', loading: true });
  const [nowMs, setNowMs] = useState(getServerNowMs);
  const refreshRef = useRef(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!supabase) return;
    const scopedTanks = JSON.parse(scope);
    let active = true, userId = null, channel = null, timer = null, controller = null, version = 0;
    const invalidate = () => { version++; controller?.abort(); };
    const fetchSnapshot = async () => {
      if (!active || !userId) return;
      invalidate();
      const request = version;
      const owner = userId;
      const ownedTanks = scopedTanks.filter(tank => tank.user_id === owner);
      const requestController = new AbortController();
      controller = requestController;
      let deadline;
      try {
        const work = Promise.all([
          loadCurrentTankRows(ownedTanks, { id: owner }, {}, supabase, requestController.signal),
          fetchThresholdRows(supabase, owner),
          syncServerTime().catch(() => null),
        ]);
        const [rows, thresholdRows] = await Promise.race([work, new Promise((_, reject) => {
          deadline = setTimeout(() => { requestController.abort(); reject(new Error('timeout')); }, 15000);
        })]);
        if (!active || version !== request || owner !== userId) return;
        setNowMs(getServerNowMs());
        setState({ scope, userId: owner, rows, thresholds: thresholdBundle(thresholdRows), loading: false,
          error: rows.errors.length ? 'Some current readings could not be verified. Refresh to retry.' : '' });
      } catch {
        if (active && version === request && owner === userId) {
          setState({ scope, userId: owner, rows: emptyRows(), thresholds: null, loading: false,
            error: 'Current readings or thresholds could not be verified. Refresh to retry.' });
        }
      } finally { clearTimeout(deadline); }
    };
    const schedule = () => {
      if (!active) return;
      invalidate(); // An older in-flight response cannot commit during debounce.
      clearTimeout(timer);
      timer = setTimeout(fetchSnapshot, 200);
    };
    refreshRef.current = schedule;
    const removeChannel = () => {
      if (channel) { void supabase.removeChannel(channel); channel = null; }
    };
    const setIdentity = nextId => {
      if (!active) return;
      if (nextId === userId && nextId) { schedule(); return; }
      invalidate(); clearTimeout(timer); removeChannel(); userId = nextId;
      setState({ scope, rows: emptyRows(), thresholds: null, userId, loading: !!userId, error: '' });
      if (!userId) return;
      channel = supabase.channel(`monitoring:${userId}:${crypto.randomUUID()}`);
      for (const table of ['sensor_readings', 'ammonia_readings']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, payload => {
          const changedTank = payload.new?.tank_id || payload.old?.tank_id;
          if (!changedTank || scopedTanks.some(tank => tank.id === changedTank)) schedule();
        });
      }
      channel.subscribe(status => { if (status === 'SUBSCRIBED') schedule(); });
      schedule();
    };
    let authEventSeen = false;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventSeen = true;
      // Supabase auth callbacks must not await another auth operation.
      setIdentity(session?.user?.id || null);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!authEventSeen) setIdentity(error ? null : data?.session?.user?.id || null);
    }).catch(() => { if (!authEventSeen) setIdentity(null); });
    const visible = () => { if (document.visibilityState === 'visible') schedule(); };
    const storage = event => { if (event.key?.startsWith('craythrive:tank-thresholds:')) schedule(); };
    window.addEventListener('online', schedule);
    window.addEventListener('focus', schedule);
    window.addEventListener(THRESHOLDS_CHANGED, schedule);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    // Threshold tables are not in the remote realtime publication. This modest
    // fallback also covers missed events; it never reloads the entire page.
    const recovery = setInterval(visible, 60000);
    const freshness = setInterval(() => setNowMs(getServerNowMs()), 15000);
    return () => {
      active = false; invalidate(); clearTimeout(timer); removeChannel();
      clearInterval(recovery); clearInterval(freshness); authListener.subscription.unsubscribe();
      window.removeEventListener('online', schedule); window.removeEventListener('focus', schedule);
      window.removeEventListener(THRESHOLDS_CHANGED, schedule); window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
      refreshRef.current = () => {};
    };
  }, [scope]);

  const current = state.scope === scope ? state : { rows: emptyRows(), thresholds: null, userId: null, error: '', loading: true };
  const verified = !current.error && !!current.thresholds;
  const availability = useMemo(() => ({ nowMs, verified }), [nowMs, verified]);
  return { ...current, refresh, nowMs, availability };
}
