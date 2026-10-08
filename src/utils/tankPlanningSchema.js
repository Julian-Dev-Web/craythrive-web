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

const FIELD_LABELS = { name: 'Tank name', type: 'Tank type', lengthCm: 'Length', widthCm: 'Width', heightCm: 'Tank height', normalWaterDepthCm: 'Normal water depth', population: 'Crayfish count', shelters: 'Shelter count', notes: 'Notes' };
const SETUP_MESSAGES = {
  TANK_CONFIG_MISSING: 'The dashboard connection is incomplete. Please ask the project administrator to check the connection settings.',
  TANK_AUTH_REQUIRED: 'Your sign-in could not be verified. Please sign in again before saving a tank.',
  TANK_SCHEMA_UNAVAILABLE: 'Unable to verify the tank setup right now. Retry setup; if this continues, contact the project administrator.',
  TANK_SCHEMA_ACCESS_DENIED: 'Your account cannot verify the tank setup. Please ask the project administrator to review access.',
  TANK_TABLE_UNAVAILABLE: 'The shared tank setup is not available to this account. Please ask the project administrator to review access.',
  TANK_CREATE_NOT_ALLOWED: 'Adding tanks is not enabled for this account. Please ask the project administrator to review access.',
  TANK_EDIT_NOT_ALLOWED: 'Editing tanks is not enabled for this account. Please ask the project administrator to review access.',
  TANK_KEY_UNSUPPORTED: 'The existing tank setup needs a compatibility review before this form can save tanks.',
  TANK_OWNER_UNAVAILABLE: 'Tank ownership needs a compatibility review before this form can save tanks.',
  TANK_FIELDS_MISSING: 'Tank planning fields have not been enabled for this setup yet. Please ask the project administrator to enable them.',
  TANK_FIELDS_AMBIGUOUS: 'Some tank planning fields need a compatibility review before saving.',
  TANK_FIELD_TYPE_UNSUPPORTED: 'Some tank planning fields use a format this form does not yet support.',
  TANK_TYPES_UNSUPPORTED: 'The existing tank setup does not yet support both Juvenile and Breeder in this form.',
  TANK_DEVICE_REQUIRED: 'This tank setup still requires device information. Please ask the project administrator to review device-free tank creation.',
  TANK_REQUIRED_FIELDS: 'This tank setup requires additional information that this form does not yet support.',
};

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
  constructor(detail, code = 'TANK_SETUP_UNKNOWN', fields = []) {
    const labels = fields.map(field => FIELD_LABELS[field]).filter(Boolean);
    const message = SETUP_MESSAGES[code] || 'Tank saving is not available for this setup yet. Please ask the project administrator to review the tank configuration.';
    super(labels.length ? `${message} Fields: ${labels.join(', ')}.` : message);
    this.name = 'TankSetupError';
    // Only this controlled code is passed to the shared diagnostic logger.
    // Raw schema/provider details, request bodies and sessions stay private.
    this.code = code;
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
  for (const [field, column] of Object.entries(contract.fields)) {
    const property = contract.properties[column];
    if (property.type === 'integer' && !Number.isSafeInteger(planningNumber(plan[field]))) errors[field] = `${FIELD_LABELS[field]} must be a whole number for this tank setup.`;
    if (property.maxLength && String(plan[field] ?? '').trim().length > property.maxLength) errors[field] = `${FIELD_LABELS[field]} must be ${property.maxLength} characters or fewer.`;
  }
  return errors;
}

// Inspect the existing authenticated API schema before allowing any write.
// Ambiguous/missing columns fail closed, rather than dropping entered fields.
export function resolveTankContract(spec, { operation = 'create' } = {}) {
  const definition = spec?.definitions?.tanks;
  const properties = definition?.properties;
  if (!properties) throw new TankSetupError('tanks schema unavailable', 'TANK_TABLE_UNAVAILABLE');
  const editing = operation === 'edit';
  if (!spec?.paths?.['/tanks']?.[editing ? 'patch' : 'post']) throw new TankSetupError('Requested tank operation unavailable', editing ? 'TANK_EDIT_NOT_ALLOWED' : 'TANK_CREATE_NOT_ALLOWED');
  const primaryKeys = Object.keys(properties).filter(key => /<pk\/>|primary key/i.test(properties[key].description || ''));
  if (primaryKeys.length !== 1 || !['id', 'tank_id', 'uuid'].includes(primaryKeys[0])) throw new TankSetupError('A supported single tanks primary key must be confirmed', 'TANK_KEY_UNSUPPORTED');
  if (!properties.user_id) throw new TankSetupError('The documented mobile ownership column user_id is unavailable', 'TANK_OWNER_UNAVAILABLE');
  const matchesByField = Object.fromEntries(Object.entries(TANK_PLAN_COLUMNS).map(([field, aliases]) => [field, aliases.filter(key => Object.hasOwn(properties, key))]));
  const missing = Object.keys(matchesByField).filter(field => matchesByField[field].length === 0);
  if (missing.length) throw new TankSetupError('Missing supported planning columns', 'TANK_FIELDS_MISSING', missing);
  const ambiguous = Object.keys(matchesByField).filter(field => matchesByField[field].length > 1);
  if (ambiguous.length) throw new TankSetupError('Ambiguous supported planning columns', 'TANK_FIELDS_AMBIGUOUS', ambiguous);
  const fields = {};
  for (const [field, matches] of Object.entries(matchesByField)) {
    fields[field] = matches[0];
    const numeric = !['name', 'type', 'notes'].includes(field);
    if (numeric && !['number', 'integer'].includes(properties[matches[0]].type)) throw new TankSetupError('Numeric planning column required', 'TANK_FIELD_TYPE_UNSUPPORTED', [field]);
    if (!numeric && properties[matches[0]].type !== 'string') throw new TankSetupError('Text planning column required', 'TANK_FIELD_TYPE_UNSUPPORTED', [field]);
  }
  const enumValues = properties[fields.type].enum;
  if (enumValues !== undefined && !Array.isArray(enumValues)) throw new TankSetupError('Tank type enum metadata is unsupported', 'TANK_TYPES_UNSUPPORTED');
  const typeValues = {};
  for (const type of ['juvenile', 'breeder']) {
    const matches = enumValues?.filter(value => String(value).toLowerCase() === type);
    if (enumValues && matches.length !== 1) throw new TankSetupError(`Existing tank type does not uniquely support ${type}`, 'TANK_TYPES_UNSUPPORTED');
    // The supplied mobile contract uses lowercase; preserve an actual enum's case.
    typeValues[type] = matches?.[0] ?? type;
  }
  const supplied = new Set([...Object.values(fields), 'user_id', ...(properties.is_paired ? ['is_paired'] : [])]);
  const required = definition.required || [];
  const missingDefaults = editing ? [] : required.filter(key => !supplied.has(key) && properties[key]?.default == null);
  if (missingDefaults.length) throw new TankSetupError('Required columns need database defaults or nullable support', missingDefaults.some(key => ['device_uid', 'iot_device_id', 'actuator_device_uid'].includes(key)) ? 'TANK_DEVICE_REQUIRED' : 'TANK_REQUIRED_FIELDS');
  return { fields, typeValues, properties, primaryKey: primaryKeys[0] };
}
