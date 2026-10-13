import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { verifyDashboardSession } from '../services/authService';

export default function ProtectedAdminRoute() {
  const [access, setAccess] = useState({ status: 'checking', userId: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true, version = 0, timer, acceptedId = null, observedId = null, currentStatus = 'checking';
    const update = result => { currentStatus = result.status; setAccess(result); };
    const schedule = () => {
      const request = ++version;
      clearTimeout(timer);
      // Run outside the Auth callback/SDK session lock; coalesce restoration events.
      timer = setTimeout(async () => {
        let deadline;
        const result = await Promise.race([verifyDashboardSession(), new Promise(resolve => {
          deadline = setTimeout(() => resolve({ status: 'unavailable', userId: null }), 15000);
        })]).catch(() => ({ status: 'unavailable', userId: null }));
        clearTimeout(deadline);
        if (!active || version !== request) return;
        acceptedId = result.status === 'authorized' ? result.userId : null;
        observedId = result.userId;
        update(result);
      }, 0);
    };
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        ++version; clearTimeout(timer); acceptedId = null; observedId = null;
        update({ status: 'unauthenticated', userId: null });
        return;
      }
      const id = session?.user?.id || null;
      if (id !== observedId) {
        observedId = id; acceptedId = null;
        // Unmount protected account state before checking a different user.
        update({ status: 'checking', userId: null });
      }
      if (!acceptedId || id !== acceptedId || event === 'USER_UPDATED') schedule();
    }).data.subscription;
    schedule();
    const recover = () => { if (currentStatus === 'unavailable') schedule(); };
    const visible = () => { if (document.visibilityState === 'visible') recover(); };
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; ++version; clearTimeout(timer); subscription?.unsubscribe();
      window.removeEventListener('online', recover); window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [retry]);

  if (access.status === "checking") {
    return (
      <main className="route-loading-page">
        <div className="route-loading-card">
          <Loader2 className="spin-icon" size={30} />
          <h2>Checking dashboard access...</h2>
          <p>Please wait while CrayThrive verifies your account permission.</p>
        </div>
      </main>
    );
  }

  if (access.status === "not-configured") {
    return (
      <main className="route-loading-page">
        <div className="route-loading-card">
          <ShieldAlert size={32} />
          <h2>Supabase is not configured.</h2>
          <p>
            Add your Supabase URL and publishable key inside the .env file before
            opening the dashboard.
          </p>
        </div>
      </main>
    );
  }

  if (access.status === 'unavailable' || access.status === 'forbidden') return (
    <main className="route-loading-page"><div className="route-loading-card">
      <ShieldAlert size={32} />
      <h2>{access.status === 'unavailable' ? 'Could not verify your connection' : 'Dashboard access unavailable'}</h2>
      <p>{access.status === 'unavailable' ? 'Your session has not been signed out. Reconnect and retry to verify access.'
        : 'This account does not have a supported CrayThrive dashboard profile.'}</p>
      {access.status === 'unavailable' ? <button type="button" className="dashboard-primary-button" onClick={() => setRetry(value => value + 1)}>Retry connection</button>
        : <Link to="/login">Back to sign in</Link>}
    </div></main>
  );
  if (access.status !== "authorized") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet key={access.userId} />;
}
