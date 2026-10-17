import { useEffect, useId, useRef } from 'react';
import { FEED_AMOUNTS, dispenseCycleLabel, normalizeDispenseCycles } from '../../supabase/functions/_shared/feederControl.js';
import '../styles/manualFeeding.css';

export default function ManualFeedOptions({ cycles, onChange, disabled, confirmation, onCancel, onConfirm, busy }) {
  const id = useId();
  const dialog = useRef(null);
  const selected = normalizeDispenseCycles(cycles);
  const confirmed = normalizeDispenseCycles(confirmation?.cycles);
  const amount = FEED_AMOUNTS.find(option => option.cycles === confirmed);
  useEffect(() => {
    if (confirmation && !dialog.current.open) dialog.current.showModal();
    else if (!confirmation && dialog.current.open) dialog.current.close();
  }, [confirmation]);
  return <div className="manual-feed-options">
    <fieldset disabled={disabled}>
      <legend>Feed Amount <span>Dispense Cycles</span></legend>
      <div className="manual-feed-choices">
        {FEED_AMOUNTS.map(option => <label key={option.cycles} className={selected === option.cycles ? 'selected' : ''}>
          <input type="radio" name={`${id}-cycles`} value={option.cycles} checked={selected === option.cycles}
            onChange={() => onChange(normalizeDispenseCycles(option.cycles))} />
          <span><b>{option.cycles} {option.cycles === 1 ? 'Cycle' : 'Cycles'}</b><small>{option.label}{option.cycles === 2 && ' · Recommended'}</small></span>
        </label>)}
      </div>
    </fieldset>
    <p className="manual-feed-note">Check that the feeder contains enough feed before dispensing.</p>
    <dialog ref={dialog} className="manual-feed-confirm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={event => { if (busy) event.preventDefault(); else onCancel(); }} onClose={onCancel}>
      <h3 id={`${id}-title`}>Feed crayfish?</h3>
      <p>Selected amount: <strong>{dispenseCycleLabel(confirmed)} — {amount.label}</strong></p>
      <p id={`${id}-description`}>The feeder will dispense feed {confirmed} {confirmed === 1 ? 'time' : 'times'}.</p>
      <p className="manual-feed-note">Check that the feeder contains enough feed before dispensing.</p>
      <div className="manual-feed-confirm-actions">
        <button type="button" disabled={busy} onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className="manual-feed-submit" disabled={busy} onClick={onConfirm}>Feed Now</button>
      </div>
    </dialog>
  </div>;
}
