import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Unplug } from 'lucide-react';
import TankPlanningGuide from '../../components/TankPlanningGuide';
import { tanksService } from '../../services/tanksService';
import { readTankPlan, TankSetupError, TankInputError, validateContractFields } from '../../utils/tankPlanningSchema';
import { getTankPairingState, validateTankPlan } from '../../utils/tankStockingGuidance';
import { getSafeErrorMessage, logDiagnostic } from '../../utils/securityDiagnostics';
import '../../styles/tankPlanning.css';

const emptyPlan = { name: '', type: 'juvenile', lengthCm: '', widthCm: '', heightCm: '', normalWaterDepthCm: '', population: '', shelters: '', notes: '' };

export default function AddTankPage() {
  const { tankId } = useParams();
  const editing = Boolean(tankId);
  const navigate = useNavigate();
  const [plan, setPlan] = useState(emptyPlan);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pairing, setPairing] = useState('Unpaired');
  const [contract, setContract] = useState(null);
  const submitting = useRef(false);
  const errorRef = useRef(null);
  const backTo = editing ? `/admin/tanks/${encodeURIComponent(tankId)}` : '/admin/tanks';

  useEffect(() => {
    let active = true;
    async function load() {
      setReady(false);
      setError('');
      try {
        const result = editing ? await tanksService.loadForEditing(tankId) : await tanksService.inspectContract();
        if (!active) return;
        setContract(result.contract);
        if (editing) { setPlan(readTankPlan(result.tank)); setPairing(getTankPairingState(result.tank)); }
        setReady(true);
      } catch (failure) {
        if (!active) return;
        logDiagnostic('Tank setup unavailable', failure);
        setError(failure instanceof TankSetupError ? failure.message : getSafeErrorMessage(failure, 'Unable to load this tank setup. Please check your connection and try again.'));
      }
    }
    load();
    return () => { active = false; };
  }, [editing, tankId, retry]);

  function change(event) {
    const { name, value } = event.target;
    setPlan(previous => ({ ...previous, [name]: value }));
    setErrors(previous => ({ ...previous, [name]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !ready) return;
    const validation = { ...validateTankPlan(plan), ...validateContractFields(plan, contract) };
    setErrors(validation);
    if (Object.keys(validation).length) {
      document.getElementById(`tank-${Object.keys(validation)[0]}`)?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await tanksService.save(plan, editing ? tankId : null);
      navigate(`/admin/tanks/${encodeURIComponent(result.id)}`, { replace: true, state: { tankSaved: true } });
    } catch (failure) {
      logDiagnostic('Tank save failed', failure);
      if (failure instanceof TankInputError) {
        setErrors(failure.fields);
        document.getElementById(`tank-${Object.keys(failure.fields)[0]}`)?.focus();
        return;
      }
      setError(failure instanceof TankSetupError ? failure.message : getSafeErrorMessage(failure, 'Unable to save your tank. Your entries are still here. Please check your connection and try again.'));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function numberField(name, label, whole = false) {
    const property = contract?.properties[contract.fields[name]];
    return <div className="tank-form-field" key={name}>
      <label htmlFor={`tank-${name}`}>{label} *</label>
      <input id={`tank-${name}`} name={name} type="number" inputMode={whole ? 'numeric' : 'decimal'}
        min={whole ? 0 : undefined} step={whole || property?.type === 'integer' ? 1 : 'any'}
        value={plan[name]} onChange={change} required aria-invalid={Boolean(errors[name])}
        aria-describedby={errors[name] ? `tank-error-${name}` : undefined} />
      {errors[name] && <small className="tank-form-field-error" id={`tank-error-${name}`}>{errors[name]}</small>}
    </div>;
  }

  return <div className="tank-form-page">
    <header className="tank-form-header">
      <Link to={backTo} className="modern-back-link"><ArrowLeft size={16} />Back to {editing ? 'Tank' : 'Tanks'}</Link>
      <p className="dashboard-eyebrow">My Tanks</p><h2>{editing ? 'Edit Tank' : 'Add Tank'}</h2>
      <p>Set up your tank and plan its stocking. You can connect a device later.</p>
      <span className="tank-pairing-state"><Unplug size={14} aria-hidden="true" />{pairing}</span>
    </header>
    {error && <div className="tank-form-error" role="alert" tabIndex={-1} ref={errorRef}>
      <p>{error}</p>{!ready && <button type="button" className="tank-form-secondary" onClick={() => setRetry(value => value + 1)}>Retry setup</button>}
    </div>}
    <form onSubmit={submit} noValidate className="tank-form-layout" aria-label={editing ? 'Edit tank' : 'Add tank'}>
      <div className="tank-form-sections">
        <fieldset disabled={saving} className="tank-form-section">
          <legend>Basic Information</legend>
          <div className="tank-form-field"><label htmlFor="tank-name">Tank name *</label>
            <input id="tank-name" name="name" value={plan.name} onChange={change} required
              maxLength={contract?.properties[contract.fields.name]?.maxLength}
              aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'tank-error-name' : undefined} />
            {errors.name && <small id="tank-error-name" className="tank-form-field-error">{errors.name}</small>}
          </div>
          <div className="tank-form-field"><label htmlFor="tank-type">Tank type *</label>
            <select id="tank-type" name="type" value={plan.type} onChange={change} disabled={editing} required aria-describedby={editing ? 'tank-type-help' : undefined}>
              {!['juvenile', 'breeder'].includes(plan.type) && <option value="">Choose a supported type</option>}
              <option value="juvenile">Juvenile</option><option value="breeder">Breeder</option>
            </select>
            {editing && <small id="tank-type-help">Tank type stays fixed to preserve how existing history is interpreted.</small>}
            {errors.type && <small className="tank-form-field-error">{errors.type}</small>}
          </div>
        </fieldset>
        <fieldset disabled={saving} className="tank-form-section">
          <legend>Tank Dimensions</legend><p>Measure the inside of the tank. All dimensions are in centimeters.</p>
          <div className="tank-form-grid">{numberField('lengthCm', 'Length (cm)')}{numberField('widthCm', 'Width (cm)')}
            {numberField('heightCm', 'Tank height (cm)')}{numberField('normalWaterDepthCm', 'Normal water depth (cm)')}</div>
          <small>Normal water depth is your planned water depth. It does not change measured sensor readings.</small>
        </fieldset>
        <fieldset disabled={saving} className="tank-form-section">
          <legend>Crayfish Stocking</legend>
          <div className="tank-form-grid">{numberField('population', 'Current / planned crayfish count', true)}{numberField('shelters', 'Number of shelters', true)}</div>
          <div className="tank-form-field"><label htmlFor="tank-notes">Notes (optional)</label><textarea id="tank-notes" name="notes" rows={3} value={plan.notes} onChange={change} maxLength={contract?.properties[contract.fields.notes]?.maxLength} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? 'tank-error-notes' : undefined} />
            {errors.notes && <small id="tank-error-notes" className="tank-form-field-error">{errors.notes}</small>}</div>
        </fieldset>
      </div>
      <aside><TankPlanningGuide plan={plan} /></aside>
      <div className="tank-form-footer"><Link to={backTo} className="tank-form-secondary" aria-disabled={saving} onClick={event => { if (saving) event.preventDefault(); }}>Cancel</Link>
        <button type="submit" className="dashboard-primary-button" disabled={!ready || saving}>
          {saving || (!ready && !error) ? <Loader2 size={16} className="tank-form-spinner" /> : <Save size={16} />}
          {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Tank'}</button>
      </div>
    </form>
  </div>;
}
