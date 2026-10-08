import { useEffect, useRef, useState } from 'react';
import { Clock, History } from 'lucide-react';
import { developerService } from '../services/developerService';

const date = value => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const size = bytes => bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export default function DeveloperBackupHistory({ busy, onDownload, onPreview, onReauthenticationRequired }) {
  const [history, setHistory] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const active = useRef(false);
  // Capture the current identity boundary; the parent unmounts this component on auth changes.
  const reauthenticate = useRef(onReauthenticationRequired);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    developerService.listBackupHistory().then(result => {
      if (cancelled) return;
      setHistory(result); setEntries(result.entries || []); setLoading(false);
    }).catch(failure => {
      if (cancelled) return;
      if (failure.reauthenticationRequired) reauthenticate.current();
      else { setError('Backup history could not be loaded. Please retry.'); setLoading(false); }
    });
    return () => { cancelled = true; active.current = false; };
  }, []);

  async function load(older = false) {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const result = await developerService.listBackupHistory(older ? history.nextCursor : undefined);
      if (!active.current) return;
      setHistory(result); setEntries(previous => older ? [...previous, ...result.entries] : result.entries);
    } catch (failure) {
      if (!active.current) return;
      if (failure.reauthenticationRequired) reauthenticate.current();
      else setError('Backup history could not be loaded. Please retry.');
    } finally { if (active.current) setLoading(false); }
  }

  return <section className="developer-backup-history" aria-labelledby="developer-history-heading">
    <h2 id="developer-history-heading"><History size={18} aria-hidden="true" />Backup history</h2>
    <div className="developer-backup-schedule">
      <p><Clock size={16} aria-hidden="true" />{history?.schedule?.enabled ? 'Automatic backup: daily at 11:55 PM (Philippine time).' : loading ? 'Checking daily backup schedule…' : 'Automatic backup is not enabled yet.'}</p>
      <p>A new backup is saved only when application data changes. Days with no changes are skipped.</p>
      {history?.schedule?.nextRunAt && <p>Next check: {date(history.schedule.nextRunAt)}</p>}
      {history?.lastRun && <p>Last check: {date(history.lastRun.checkedAt)} · {history.lastRun.source === 'automatic' ? 'Automatic' : 'Manual'} · {history.lastRun.status === 'skipped' ? 'No changes — skipped' : history.lastRun.status === 'saved' ? 'Backup saved' : 'Backup failed — please retry'}</p>}
    </div>
    <button type="button" disabled={busy || loading} onClick={() => load()}>Refresh history</button>
    {loading && <p aria-live="polite">Loading backup history…</p>}
    {error && <p role="alert" className="developer-error">{error}</p>}
    {!loading && !error && entries.length === 0 && <p>No saved backups yet. Download a backup now or wait for the first daily check.</p>}
    {entries.length > 0 && <ol className="developer-backup-list">
      {entries.map(item => <li key={item.id}>
        <div><strong>{date(item.createdAt)}</strong><p>{item.source === 'automatic' ? 'Automatic' : 'Manual'} · {item.recordCount.toLocaleString()} records · {size(item.byteSize)}</p></div>
        <div className="developer-backup-actions">
          <button type="button" disabled={busy || loading} aria-label={`Download backup from ${date(item.createdAt)}`} onClick={() => onDownload(item)}>Download</button>
          <button type="button" disabled={busy || loading} aria-label={`Preview restore from ${date(item.createdAt)}`} onClick={() => onPreview(item)}>Preview restore</button>
        </div>
      </li>)}
    </ol>}
    {history?.nextCursor && <button type="button" disabled={busy || loading} onClick={() => load(true)}>Load older backups</button>}
    <p>Saved backups stay in history. Download important backups to keep an extra copy.</p>
  </section>;
}
