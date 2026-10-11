import { supabase } from '../lib/supabase';
import { createServerClock } from '../../supabase/functions/_shared/serverClock.js';

const clock = createServerClock();
let pending = null;
export const getServerNowMs = () => clock.now();
export const getServerNowDate = () => {
  const now = clock.now();
  return now === null ? null : new Date(now);
};
export const clearServerClock = () => clock.clear();

export async function syncServerTime() {
  if (!supabase) throw new Error('Server time unavailable.');
  if (!pending) pending = (async () => {
    const { data, error } = await supabase.rpc('craythrive_server_time');
    if (error) throw new Error('Server time unavailable.');
    clock.set(data);
    return data;
  })().finally(() => { pending = null; });
  return pending;
}

// Use the fresh database response itself for authoritative update timestamps;
// interpolation is only for display/freshness checks, never new record times.
export const fetchServerTimestamp = syncServerTime;
