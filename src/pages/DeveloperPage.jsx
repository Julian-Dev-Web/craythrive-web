import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';
import { developerService } from '../services/developerService';
import { supabase } from '../lib/supabase';
import '../styles/developer.css';
import DeveloperBackupTools from '../components/DeveloperBackupTools';

export default function DeveloperPage() {
  const [access, setAccess] = useState(null);
  const [factor, setFactor] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    function invalidate() { generation.current++; }
    async function check() {
      const version = ++generation.current;
      try {
        const result = await developerService.checkAccess();
        if (active && version === generation.current) setAccess(result);
      } catch {
        if (active && version === generation.current) setAccess({ authorized: false });
      }
    }
    check();
    const subscription = supabase?.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        invalidate();
        setAccess(null); setFactor(null); setCode(''); setError('');
        queueMicrotask(() => { if (active) check(); });
      }
    }).data.subscription;
    return () => { active = false; invalidate(); subscription?.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!access?.authorized || access.reauthenticationRequired) return;
    const timeout = setTimeout(() => setAccess(previous => previous ? { ...previous, reauthenticationRequired: true } : previous),
      Math.max(0, access.verifiedUntil * 1000 - Date.now()));
    return () => clearTimeout(timeout);
  }, [access]);

  async function run(action) {
    if (submitting.current) return;
    const version = generation.current;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await action();
      if (version !== generation.current) return;
      if (result.authorized) { setAccess(result); setFactor(null); setCode(''); }
      else setFactor(result);
    } catch {
      if (version === generation.current) setError('Verification could not be completed. Please try again.');
    } finally {
      submitting.current = false; setBusy(false);
    }
  }

  return <main className="developer-page">
    <section className="developer-card">
      <Link to="/admin" className="developer-back"><ArrowLeft size={16} aria-hidden="true" />Back to dashboard</Link>
      <LockKeyhole size={28} aria-hidden="true" /><h1>Developer Mode</h1>
      {!access ? <p role="status">Verifying access…</p>
        : !access.authorized ? <p role="alert">Developer access is unavailable for this session.</p>
          : access.reauthenticationRequired ? <>
            <h2>Verify your identity</h2>
            <p>Use your authenticator app to continue.</p>
            {error && <p role="alert" className="developer-error">{error}</p>}
            {!factor ? <button type="button" className="dashboard-primary-button" disabled={busy} onClick={() => run(() => developerService.beginVerification())}>Continue verification</button>
              : !factor.factorId ? <>
                <p>No authenticator is configured for this account.</p>
                <button type="button" className="dashboard-primary-button" disabled={busy} onClick={() => run(() => developerService.beginVerification(true))}>Set up authenticator</button>
              </> : <form onSubmit={event => { event.preventDefault(); run(() => developerService.verifyOtp(factor.factorId, code)); }}>
                {factor.qrCode && <div className="developer-qr"><p>Scan this code with your authenticator app.</p><img alt="Authenticator setup QR code" src={factor.qrCode} /></div>}
                <label htmlFor="developer-otp">Authenticator code</label>
                <input id="developer-otp" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} />
                <button type="submit" className="dashboard-primary-button" disabled={busy}>{busy ? 'Verifying…' : 'Verify code'}</button>
              </form>}
          </> : <>
            <p className="developer-verified"><ShieldCheck size={18} aria-hidden="true" />Identity verified</p>
            <DeveloperBackupTools onReauthenticationRequired={() => {
              generation.current++;
              setAccess(previous => previous ? { ...previous, reauthenticationRequired: true } : previous);
              setFactor(null); setCode('');
            }} />
          </>}
    </section>
  </main>;
}
