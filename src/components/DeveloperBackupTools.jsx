import { useEffect, useRef, useState } from 'react';
import { Download, FileCheck, RotateCcw } from 'lucide-react';
import { developerService } from '../services/developerService';
import DeveloperBackupHistory from './DeveloperBackupHistory';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
function downloadBackup(backup, prefix) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `${prefix}-${new Date().toISOString().replaceAll(':', '-')}.ctbackup`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DeveloperBackupTools({ onReauthenticationRequired }) {
  const [backup, setBackup] = useState(null);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [exportSummary, setExportSummary] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, preview.expiresAt * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [preview]);

  async function run(action) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (failure) {
      if (!active.current) return;
      if (failure.reauthenticationRequired) onReauthenticationRequired();
      else setError(failure.message || 'The operation could not be completed. Please retry.');
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function selectFile(file) {
    setPreview(null); setBackup(null); setFilename(''); setConfirmation(''); setRecoverySaved(false);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) throw new Error('Choose a backup smaller than 12 MB.');
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error('Choose a valid CrayThrive .ctbackup file.'); }
    if (parsed?.format !== 'craythrive-backup' || parsed.version !== 1 || typeof parsed.ciphertext !== 'string' || typeof parsed.iv !== 'string') {
      throw new Error('Choose an encrypted CrayThrive .ctbackup file.');
    }
    if (active.current) { setBackup(parsed); setFilename(file.name); }
  }

  async function exportBackup() {
    const result = await developerService.exportBackup();
    if (!active.current) return;
    downloadBackup(result.backup, 'craythrive-backup');
    setExportSummary(result); setHistoryVersion(previous => previous + 1);
    setMessage(result.status === 'skipped' ? 'Encrypted backup downloaded. No changes since the saved backup, so history was kept unchanged.' : 'Encrypted backup downloaded and saved in history.');
  }
  async function previewRestore(archive = backup) {
    setPreview(null); setConfirmation(''); setRecoverySaved(false);
    const result = await developerService.previewRestore(archive);
    if (!active.current) return;
    downloadBackup(result.recoveryBackup, 'craythrive-recovery');
    setExpired(false); setPreview(result);
    setMessage('Preview ready. A recovery backup was downloaded before making changes.');
  }
  async function applyRestore() {
    const result = await developerService.applyRestore(backup, preview.previewToken, confirmation);
    if (!active.current) return;
    if (result.restored !== true) throw new Error('The server did not confirm the restore. Preview again before retrying.');
    setPreview(null); setConfirmation(''); setRecoverySaved(false);
    setMessage('Restore completed. Refresh the dashboard to see the restored data.');
  }

  return <div className="developer-tools">
    <section aria-labelledby="developer-backup-heading">
      <h2 id="developer-backup-heading"><Download size={18} aria-hidden="true" />Backup application data</h2>
      <p>Download an encrypted copy of CrayThrive application data for all users. Auth accounts, passwords, MFA, server secrets and uploaded files are excluded.</p>
      <button type="button" className="dashboard-primary-button" disabled={busy} onClick={() => run(exportBackup)}>{busy ? 'Please wait…' : 'Download backup'}</button>
      {exportSummary && <p>{exportSummary.tables.length} tables · {exportSummary.tables.reduce((sum, table) => sum + table.rows, 0).toLocaleString()} records exported.</p>}
      {exportSummary?.excludedTables?.length > 0 && <p>Other tables excluded: {exportSummary.excludedTables.join(', ')}.</p>}
    </section>
    <section aria-labelledby="developer-restore-heading">
      <h2 id="developer-restore-heading"><RotateCcw size={18} aria-hidden="true" />Restore application data</h2>
      <p>Restore merges backup records: matching IDs are overwritten, missing records are added, and other current records stay. Device commands, push tokens and live automation settings are kept unchanged.</p>
      <label htmlFor="developer-backup-file">CrayThrive backup file</label>
      <input id="developer-backup-file" type="file" accept=".ctbackup,application/json" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; run(() => selectFile(file));
      }} />
      {filename && <p className="developer-filename">{filename}</p>}
      <button type="button" className="dashboard-primary-button" disabled={busy || !backup} onClick={() => run(() => previewRestore())}>Preview restore</button>
      {preview && <div className="developer-restore-preview">
        <h3><FileCheck size={18} aria-hidden="true" />Restore preview</h3>
        <p>Backup created: {new Date(preview.createdAt).toLocaleString()}</p>
        <div className="developer-preview-scroll"><table>
          <caption>Records affected by this restore</caption>
          <thead><tr><th scope="col">Table</th><th scope="col">Add</th><th scope="col">Update</th><th scope="col">Same</th></tr></thead>
          <tbody>{preview.tables.map(table => <tr key={table.name}><th scope="row">{table.name}</th><td>{table.inserted}</td><td>{table.updated}</td><td>{table.unchanged}</td></tr>)}</tbody>
        </table></div>
        {preview.skippedTables?.length > 0 && <p>Export only: {preview.skippedTables.join(', ')}.</p>}
        <button type="button" disabled={busy} onClick={() => downloadBackup(preview.recoveryBackup, 'craythrive-recovery')}>Download recovery backup again</button>
        <label className="developer-recovery-check"><input type="checkbox" checked={recoverySaved} disabled={busy} onChange={event => setRecoverySaved(event.target.checked)} />I saved the recovery backup and reviewed the changes.</label>
        <label htmlFor="developer-restore-confirm">Type RESTORE to confirm</label>
        <input id="developer-restore-confirm" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
        {expired && <p role="status">Preview expired. Preview the backup again before restoring.</p>}
        <button type="button" className="developer-restore-button" disabled={busy || expired || !recoverySaved || confirmation !== 'RESTORE'} onClick={() => run(applyRestore)}>Restore data</button>
      </div>}
    </section>
    <DeveloperBackupHistory key={historyVersion} busy={busy} onReauthenticationRequired={onReauthenticationRequired}
      onDownload={item => run(async () => {
        const result = await developerService.downloadStoredBackup(item.id);
        if (!active.current) return;
        downloadBackup(result.backup, 'craythrive-backup'); setMessage('Saved encrypted backup downloaded.');
      })}
      onPreview={item => run(async () => {
        const result = await developerService.downloadStoredBackup(item.id);
        if (!active.current) return;
        setBackup(result.backup); setFilename(`Saved backup · ${new Date(result.createdAt).toLocaleString()}`);
        await previewRestore(result.backup);
      })} />
    {error && <p role="alert" className="developer-error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
