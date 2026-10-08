import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, Plus, Unplug } from 'lucide-react';
import { tanksService } from '../../services/tanksService';
import { DEFAULT_JUVENILE_COUNT, JUVENILE_GUIDANCE, TANK_TYPES, TankFormError, getDefaultTankPopulation, validateTankForm } from '../../utils/tankCreationRules';
import { getSafeErrorMessage, logDiagnostic } from '../../utils/securityDiagnostics';
import '../../styles/tankCreation.css';

export default function AddTankPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', type: TANK_TYPES.BREEDER, juvenileCount: String(DEFAULT_JUVENILE_COUNT), notes: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const errorRef = useRef(null);
  const population = getDefaultTankPopulation(form.type, form.juvenileCount);
  const breeder = form.type === TANK_TYPES.BREEDER;

  function change(event) {
    const { name, value } = event.target;
    setForm(previous => ({ ...previous, [name]: value }));
    setErrors(previous => ({ ...previous, [name]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const validation = validateTankForm(form);
    setErrors(validation);
    setError('');
    if (Object.keys(validation).length) {
      document.getElementById(`create-tank-${Object.keys(validation)[0]}`)?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const result = await tanksService.create(form);
      navigate('/admin/tanks', { replace: true, state: { tankCreated: { id: result.id, name: result.tank.tank_name } } });
    } catch (failure) {
      logDiagnostic('Tank creation failed', failure);
      if (failure instanceof TankFormError) setErrors(failure.fields);
      else setError(['TANK_AUTH_REQUIRED', 'TANK_CONFIG_MISSING', 'TANK_RESULT_UNCONFIRMED'].includes(failure.code)
        ? failure.message : getSafeErrorMessage(failure, 'Unable to create your tank. Your entries are still here. Please check your connection and try again.'));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return <div className="tank-create-page">
    <header className="tank-create-header">
      <Link to="/admin/tanks" className="modern-back-link"><ArrowLeft size={16} />Back to Tanks</Link>
      <p className="dashboard-eyebrow">My Tanks</p><h2>Add Tank</h2>
      <p>Choose your tank type and population. You can connect a device later.</p>
      <span className="tank-pairing-state"><Unplug size={14} aria-hidden="true" />Unpaired</span>
    </header>
    {error && <div className="tank-create-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
    <form className="tank-create-form" onSubmit={submit} noValidate aria-label="Add tank">
      <fieldset disabled={saving} className="tank-create-section">
        <legend>Tank details</legend>
        <div className="tank-create-field">
          <label htmlFor="create-tank-name">Tank Name *</label>
          <input id="create-tank-name" name="name" value={form.name} onChange={change} placeholder={breeder ? 'Breeder Tank 1' : 'Juvenile Tank 1'} required
            aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'create-tank-name-error' : undefined} />
          {errors.name && <small id="create-tank-name-error" className="tank-create-field-error">{errors.name}</small>}
        </div>
        <fieldset className="tank-create-type-fieldset">
          <legend>Tank Type *</legend>
          <div className="tank-create-types">
            {[{ value: TANK_TYPES.BREEDER, label: 'Breeder', description: '1 male + 2 females' }, { value: TANK_TYPES.JUVENILE, label: 'Juvenile', description: JUVENILE_GUIDANCE }].map(type =>
              <label key={type.value} className={`tank-create-type${form.type === type.value ? ' selected' : ''}`}>
                <input type="radio" name="type" value={type.value} checked={form.type === type.value} onChange={change} required />
                <span><strong>{type.label}</strong><small>{type.description}</small></span>
                {form.type === type.value && <CheckCircle2 size={18} aria-hidden="true" />}
              </label>)}
          </div>
          {errors.type && <small className="tank-create-field-error">{errors.type}</small>}
        </fieldset>
        {breeder ? <div className="tank-create-guidance"><h3>Breeder population</h3><p>This tank uses the default setup of 1 male and 2 females.</p></div>
          : <div className="tank-create-field">
            <label htmlFor="create-tank-juvenileCount">Juvenile Count *</label>
            <input id="create-tank-juvenileCount" name="juvenileCount" type="number" inputMode="numeric" min="0" step="1" value={form.juvenileCount} onChange={change} required
              aria-invalid={Boolean(errors.juvenileCount)} aria-describedby={`create-tank-count-help${errors.juvenileCount ? ' create-tank-count-error' : ''}`} />
            <small id="create-tank-count-help">Recommended: {JUVENILE_GUIDANCE}.</small>
            {errors.juvenileCount && <small id="create-tank-count-error" className="tank-create-field-error">{errors.juvenileCount}</small>}
          </div>}
        <div className="tank-create-field">
          <label htmlFor="create-tank-notes">Notes (optional)</label>
          <textarea id="create-tank-notes" name="notes" rows={3} value={form.notes} onChange={change} aria-invalid={Boolean(errors.notes)} />
          {errors.notes && <small className="tank-create-field-error">{errors.notes}</small>}
        </div>
      </fieldset>
      <section className="tank-create-summary" aria-label="Tank summary" aria-live="polite">
        <h3>Tank summary</h3>
        <dl>
          <div><dt>Population</dt><dd>{breeder ? '1 male + 2 females' : population ? `${population.juvenile} ${population.juvenile === 1 ? 'juvenile' : 'juveniles'}` : 'Enter a juvenile count'}</dd></div>
          <div><dt>Type</dt><dd>{breeder ? 'Breeder' : 'Juvenile'}</dd></div>
          <div><dt>Device</dt><dd><Unplug size={14} aria-hidden="true" />Unpaired</dd></div>
        </dl>
      </section>
      <div className="tank-create-footer">
        <Link to="/admin/tanks" className="tank-create-cancel" aria-disabled={saving} onClick={event => { if (saving) event.preventDefault(); }}>Cancel</Link>
        <button className="dashboard-primary-button" type="submit" disabled={saving}>
          {saving ? <Loader2 size={16} className="tank-create-spinner" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          {saving ? 'Creating…' : 'Create Tank'}
        </button>
      </div>
    </form>
  </div>;
}
