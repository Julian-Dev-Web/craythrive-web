import { planningNumber } from './tankStockingGuidance.js';

// Only explicit cm columns are eligible. Never use sensor water_depth_cm,
// water_distance_cm, unspecified-unit dimensions, or generic "capacity".
export const TANK_PLAN_COLUMNS = Object.freeze({
  name: ['name', 'tank_name'], type: ['tank_type', 'type'],
  lengthCm: ['length_cm', 'tank_length_cm'], widthCm: ['width_cm', 'tank_width_cm'],
  heightCm: ['height_cm', 'tank_height_cm'],
  normalWaterDepthCm: ['normal_water_depth_cm', 'working_water_depth_cm', 'target_water_depth_cm'],
  population: ['crayfish_count', 'population'], shelters: ['shelter_count', 'shelters_count', 'number_of_shelters'],
  notes: ['notes'],
});

export function readTankPlan(tank = {}) {
  const plan = {};
  for (const [field, aliases] of Object.entries(TANK_PLAN_COLUMNS)) {
    const column = aliases.find(key => tank[key] !== undefined && tank[key] !== null);
    plan[field] = column ? tank[column] : '';
  }
  plan.type = String(plan.type).toLowerCase();
  return plan;
}

export class TankSetupError extends Error {
  constructor(detail) {
    super('Tank saving is not available for this setup yet. Please ask the project administrator to review the tank configuration.');
    this.name = 'TankSetupError';
    this.detail = detail;
  }
}

export class TankInputError extends Error {
  constructor(errors) {
    super(Object.values(errors)[0]);
    this.name = 'TankInputError';
    this.fields = errors;
  }
}

export function validateContractFields(plan, contract) {
  const errors = {};
  const labels = { name: 'Tank name', type: 'Tank type', lengthCm: 'Length', widthCm: 'Width', heightCm: 'Tank height', normalWaterDepthCm: 'Normal water depth', population: 'Crayfish count', shelters: 'Shelter count', notes: 'Notes' };
  for (const [field, column] of Object.entries(contract.fields)) {
    const property = contract.properties[column];
    if (property.type === 'integer' && !Number.isSafeInteger(planningNumber(plan[field]))) errors[field] = `${labels[field]} must be a whole number for this tank setup.`;
    if (property.maxLength && String(plan[field] ?? '').trim().length > property.maxLength) errors[field] = `${labels[field]} must be ${property.maxLength} characters or fewer.`;
  }
  return errors;
}

// Inspect the existing authenticated API schema before allowing any write.
// Ambiguous/missing columns fail closed, rather than dropping entered fields.
export function resolveTankContract(spec) {
  const definition = spec?.definitions?.tanks;
  const properties = definition?.properties;
  if (!properties || !spec?.paths?.['/tanks']?.post || !spec?.paths?.['/tanks']?.patch) throw new TankSetupError('tanks schema or insert/update permission unavailable');
  const primaryKeys = Object.keys(properties).filter(key => /<pk\/>|primary key/i.test(properties[key].description || ''));
  if (primaryKeys.length !== 1 || !['id', 'tank_id', 'uuid'].includes(primaryKeys[0])) throw new TankSetupError('A supported single tanks primary key must be confirmed');
  if (!properties.user_id) throw new TankSetupError('The documented mobile ownership column user_id is unavailable');
  const fields = {};
  for (const [field, aliases] of Object.entries(TANK_PLAN_COLUMNS)) {
    const matches = aliases.filter(key => Object.hasOwn(properties, key));
    if (matches.length !== 1) throw new TankSetupError(`${field}: missing or ambiguous existing column (${aliases.join(', ')})`);
    fields[field] = matches[0];
    const numeric = !['name', 'type', 'notes'].includes(field);
    if (numeric && !['number', 'integer'].includes(properties[matches[0]].type)) throw new TankSetupError(`${field}: a numeric column must be confirmed`);
    if (!numeric && properties[matches[0]].type !== 'string') throw new TankSetupError(`${field}: a text column must be confirmed`);
  }
  const enumValues = properties[fields.type].enum;
  const typeValues = {};
  for (const type of ['juvenile', 'breeder']) {
    const matches = enumValues?.filter(value => String(value).toLowerCase() === type);
    if (enumValues && matches.length !== 1) throw new TankSetupError(`Existing tank type does not uniquely support ${type}`);
    // The supplied mobile contract uses lowercase; preserve an actual enum's case.
    typeValues[type] = matches?.[0] ?? type;
  }
  const supplied = new Set([...Object.values(fields), 'user_id', ...(properties.is_paired ? ['is_paired'] : [])]);
  const required = definition.required || [];
  const missingDefaults = required.filter(key => !supplied.has(key) && properties[key]?.default === undefined);
  if (missingDefaults.length) throw new TankSetupError(`Required columns need database defaults or nullable support: ${missingDefaults.join(', ')}`);
  return { fields, typeValues, properties, primaryKey: primaryKeys[0] };
}
