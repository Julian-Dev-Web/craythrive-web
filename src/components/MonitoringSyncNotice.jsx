import { formatPhilippineDateTime } from '../utils/philippineTime';
import { sensorObservationHealth } from '../../supabase/functions/_shared/sensorReadingContract.js';

export default function MonitoringSyncNotice({ monitoring, reading }) {
  const health = sensorObservationHealth(reading, monitoring.nowMs);
  return <div className="monitoring-sync-notice" aria-live="polite">
    {monitoring.error ? <p role="alert">{monitoring.error} <button type="button" onClick={monitoring.refresh}>Retry readings</button></p>
      : <small>{monitoring.loading ? 'Checking current readings…'
        : !reading ? 'No sensor reading'
        : `${health === 'fresh' ? 'Latest sensor reading' : health === 'stale' ? 'Stale sensor reading' : 'Reading time unverified'}: ${formatPhilippineDateTime(reading.created_at, {}, 'Timestamp unavailable')} (Asia/Manila)`}</small>}
  </div>;
}
