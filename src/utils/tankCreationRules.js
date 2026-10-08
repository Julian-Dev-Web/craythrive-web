// Confirmed screen behavior comes from the owner's mobile AddTankScreen brief.
// Storage names/casing come from the supplied public.tanks DDL, 2026-10-08.
// Mobile tankRules.js itself is unavailable: do not invent its reference/labels
// or turn the 15–20 UI recommendation into an unverified validation constraint.
export const TANK_TYPES = Object.freeze({ BREEDER: 'breeder', JUVENILE: 'juvenile' });
export const DEFAULT_JUVENILE_COUNT = 15;
export const JUVENILE_GUIDANCE = '15 to 20 crayfish';
const STORED_TYPES = Object.freeze({ breeder: 'Breeder', juvenile: 'Juvenile' });
const MAX_COUNT = 2147483647; // Existing PostgreSQL integer columns.

export function parseJuvenileCount(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  if (typeof value === 'string' && !/^\d+(?:\.0+)?$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 && count <= MAX_COUNT ? count : null;
}

export function getDefaultTankPopulation(type, juvenileCount = DEFAULT_JUVENILE_COUNT) {
  if (type === TANK_TYPES.BREEDER) return { male: 1, female: 2, juvenile: 0, total: 3 };
  if (type !== TANK_TYPES.JUVENILE) return null;
  const count = parseJuvenileCount(juvenileCount);
  return count === null ? null : { male: 0, female: 0, juvenile: count, total: count };
}

export function validateTankForm(form) {
  const errors = {};
  if (typeof form.name !== 'string' || !form.name.trim()) errors.name = 'Enter a tank name.';
  if (!Object.hasOwn(STORED_TYPES, form.type)) errors.type = 'Choose Breeder or Juvenile.';
  if (form.type === TANK_TYPES.JUVENILE && parseJuvenileCount(form.juvenileCount) === null) errors.juvenileCount = 'Enter a valid whole juvenile count (zero or more).';
  if (form.notes != null && typeof form.notes !== 'string') errors.notes = 'Enter notes as text.';
  return errors;
}

export class TankFormError extends Error {
  constructor(fields) {
    super(Object.values(fields)[0]);
    this.name = 'TankFormError';
    this.code = 'TANK_FORM_INVALID';
    this.fields = fields;
  }
}

export function buildTankPayload(form, verifiedUserId) {
  const errors = validateTankForm(form);
  if (Object.keys(errors).length) throw new TankFormError(errors);
  if (typeof verifiedUserId !== 'string' || !verifiedUserId.trim()) throw new Error('Please sign in again before creating a tank.');
  const population = getDefaultTankPopulation(form.type, form.juvenileCount);
  return {
    user_id: verifiedUserId,
    tank_name: form.name.trim(),
    tank_type: STORED_TYPES[form.type],
    male_count: population.male,
    female_count: population.female,
    juvenile_count: population.juvenile,
    notes: form.notes?.trim() || null,
    has_paired_device: false,
    status: 'Unpaired',
  };
}

// Display stored counters rather than depending on an unconfirmed mobile label
// format. Old rows without counters retain their existing monitoring display.
export function getTankPopulationLabel(tank) {
  const type = String(tank?.tank_type || '').toLowerCase();
  if (type === TANK_TYPES.JUVENILE) {
    const count = parseJuvenileCount(tank.juvenile_count);
    return count === null ? null : `${count} ${count === 1 ? 'juvenile' : 'juveniles'}`;
  }
  if (type === TANK_TYPES.BREEDER) {
    const male = parseJuvenileCount(tank.male_count), female = parseJuvenileCount(tank.female_count);
    return male === null || female === null ? null : `${male} ${male === 1 ? 'male' : 'males'} + ${female} ${female === 1 ? 'female' : 'females'}`;
  }
  return null;
}
