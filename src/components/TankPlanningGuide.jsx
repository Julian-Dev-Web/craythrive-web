import SafetyBadge from './SafetyBadge';
import { calculateFloorAreaM2, calculateWorkingVolumeLiters, evaluatePlannedPopulation,
  getBreederStockingGuidance, getJuvenileStockingGuidance, planningNumber } from '../utils/tankStockingGuidance';
import '../styles/tankPlanning.css';

function display(value, unit = '') {
  const precision = value > 0 && value < .01 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 };
  return Number.isFinite(value) ? `${value.toLocaleString(undefined, precision)}${unit}` : 'Not entered';
}

export default function TankPlanningGuide({ plan, saved = false }) {
  const area = calculateFloorAreaM2(plan.lengthCm, plan.widthCm);
  const depth = planningNumber(plan.normalWaterDepthCm), height = planningNumber(plan.heightCm);
  const validDepth = depth > 0 && height > 0 && depth <= height;
  const volume = validDepth ? calculateWorkingVolumeLiters(plan.lengthCm, plan.widthCm, depth) : null;
  const juvenile = getJuvenileStockingGuidance(area);
  const breeder = getBreederStockingGuidance();
  const evaluation = evaluatePlannedPopulation(plan);
  const hasDimensions = [plan.lengthCm, plan.widthCm, plan.heightCm].every(value => planningNumber(value) > 0);
  return (
    <section className="tank-planning-guide" aria-label="Tank Planning Guide">
      <div className="tank-planning-heading">
        <div><p className="dashboard-eyebrow">{saved ? 'Saved setup · Separate from sensor readings' : 'Live estimate'}</p><h3>Tank Planning Guide</h3></div>
        {evaluation && <SafetyBadge severity={evaluation.severity} />}
      </div>
      <dl className="tank-planning-facts">
        <div><dt>Tank type</dt><dd>{plan.type === 'juvenile' ? 'Juvenile' : plan.type === 'breeder' ? 'Breeder' : 'Not entered'}</dd></div>
        <div><dt>Tank dimensions (L × W × H)</dt><dd>{hasDimensions ? `${plan.lengthCm} × ${plan.widthCm} × ${plan.heightCm} cm` : 'Not entered'}</dd></div>
        <div><dt>Normal water depth (planned)</dt><dd>{display(depth > 0 ? depth : null, ' cm')}</dd></div>
        <div><dt>Floor area</dt><dd data-testid="planning-area">{display(area, ' m²')}</dd></div>
        <div><dt>Approximate working water volume</dt><dd data-testid="planning-volume">{display(volume, ' L')}</dd></div>
        <div><dt>{saved ? 'Current / planned population' : 'Planned population'}</dt><dd>{display(planningNumber(plan.population))}</dd></div>
        <div><dt>Shelters</dt><dd>{display(planningNumber(plan.shelters))}</dd></div>
        {evaluation && <div><dt>Planned animals per m²</dt><dd>{display(evaluation.densityPerM2)}</dd></div>}
      </dl>
      {plan.type === 'juvenile' && juvenile && (
        <div className="tank-planning-reference">
          {juvenile.belowReferenceArea ? <p>This tank is below the reference floor area. Review the tank setup and available shelters before stocking.</p>
            : <><p><span>Estimated juvenile range</span><strong>{juvenile.low}–{juvenile.upper} advanced juveniles</strong></p>
              <p><span>Beginner starting estimate</span><strong>Around {juvenile.beginner}</strong></p></>}
          <small>5–15 advanced juveniles per m² is a pond grow-out reference, not a validated small-tank capacity.</small>
        </div>
      )}
      {plan.type === 'breeder' && (
        <div className="tank-planning-reference"><p><span>Suggested breeder group</span><strong>{breeder.males} male + {breeder.females} females</strong></p>
          <small>CrayThrive project recommendation. No validated breeder density is configured, so floor area and animal count do not establish a maximum capacity.</small></div>
      )}
      {evaluation ? <div className="tank-planning-explanation" aria-live="polite"><strong>Stocking guidance · {evaluation.severity === 'normal' ? 'Normal' : 'Warning'}</strong>
        {evaluation.messages.map(message => <p key={message}>{message}</p>)}</div>
        : <p className="tank-planning-note">Enter a supported tank type, dimensions, and population to see stocking guidance.</p>}
      <p className="tank-planning-note">Provide multiple hiding areas, such as PVC pipes. Stocking guidance is an estimate based on floor area and life stage. Actual suitable stocking depends on crayfish size, shelters, filtration, water quality, and management.</p>
      {saved && plan.notes && <p className="tank-planning-notes"><strong>Notes</strong><br />{plan.notes}</p>}
      <details className="tank-planning-sources"><summary>Guidance sources</summary>
        <p>Juvenile reference: <a href="https://www.business.qld.gov.au/industries/farms-fishing-forestry/fisheries/aquaculture/species/redclaw-crayfish" target="_blank" rel="noreferrer">Queensland Government redclaw grow-out guidance</a>.</p>
        <p>Controlled breeding studies include ratios from about 1:1 to 1:4: <a href="https://researchonline.jcu.edu.au/78909/1/Redclaw%20sex-separated%20system-23.pdf" target="_blank" rel="noreferrer">Nesa et al. (2023)</a> and <a href="https://era.dpi.qld.gov.au/id/eprint/11192/" target="_blank" rel="noreferrer">Jones (1995)</a>. The 1:2 group is a project preference, not the only valid ratio.</p>
      </details>
    </section>
  );
}
