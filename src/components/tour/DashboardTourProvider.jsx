import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { DashboardTourContext } from '../../context/DashboardTourContext';
import { dashboardTourSession } from '../../utils/dashboardTour';
import DashboardTourOverlay from './DashboardTourOverlay';
import '../../styles/dashboardTour.css';

export default function DashboardTourProvider({ children }) {
  const location = useLocation();
  const [invitation, setInvitation] = useState(null);
  const [running, setRunning] = useState(false);
  const focusBeforeTour = useRef(null);
  const account = useRef(null);

  useEffect(() => {
    let cancelled = false;
    // Only consume a ticket created by an explicit successful login. Restored
    // sessions and Auth SIGNED_IN/TOKEN_REFRESHED events never create tickets.
    supabase?.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      account.current = data?.session?.user?.id;
      const offered = location.pathname === '/admin' ? dashboardTourSession.claimInvitation(account.current) : null;
      setInvitation(offered ? { ...offered, locationKey: location.key } : null);
    }).catch(() => { /* A tour invitation never blocks authentication or navigation. */ });
    return () => { cancelled = true; };
  }, [location.key, location.pathname]);

  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && account.current && account.current !== session?.user?.id)) {
        dashboardTourSession.clearLogin(); setInvitation(null); setRunning(false);
      }
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, []);

  const dismissInvitation = useCallback(() => {
    dashboardTourSession.dismiss(); setInvitation(null);
  }, []);
  const startTour = useCallback(() => {
    focusBeforeTour.current = document.activeElement;
    dashboardTourSession.dismiss(); setInvitation(null); setRunning(true);
  }, []);
  const closeTour = useCallback(completed => {
    if (completed) dashboardTourSession.complete();
    setRunning(false);
  }, []);

  return <DashboardTourContext.Provider value={{ startTour, dismissInvitation,
    invitation: invitation?.locationKey === location.key && location.pathname === '/admin' ? invitation : null }}>
    {children}
    {running && <DashboardTourOverlay onClose={closeTour} focusBeforeTour={focusBeforeTour} />}
  </DashboardTourContext.Provider>;
}
