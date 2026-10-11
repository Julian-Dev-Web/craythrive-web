import { useEffect, useState } from 'react';
import { clearServerClock, getServerNowMs, syncServerTime } from '../services/serverTimeService';

export default function useServerTime() {
  const [now, setNow] = useState(getServerNowMs);
  useEffect(() => {
    let active = true;
    const refresh = () => syncServerTime().then(() => { if (active) setNow(getServerNowMs()); })
      .catch(() => { if (active) setNow(getServerNowMs()); });
    const visible = () => {
      clearServerClock();
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const tick = setInterval(() => { if (active) setNow(getServerNowMs()); }, 1000);
    const sync = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; clearInterval(tick); clearInterval(sync);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return now;
}
