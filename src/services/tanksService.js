import { supabase } from '../lib/supabase';
import { TABLES, COLUMNS } from '../constants/schema';
import { publicTankContract, TankSetupError, TankInputError, validateContractFields } from '../utils/tankPlanningSchema';
import { planningNumber, validateTankPlan } from '../utils/tankStockingGuidance';

export function createTanksService({ client, fetcher = fetch }) {
  async function authenticatedUser() {
    if (!client) throw new TankSetupError('Supabase client unavailable', 'TANK_CONFIG_MISSING');
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user?.id) throw new TankSetupError('Authenticated user unavailable', 'TANK_AUTH_REQUIRED');
    return data.user;
  }

  async function inspectContract(operation = 'create') {
    const user = await authenticatedUser();
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new TankSetupError('Authenticated session unavailable', 'TANK_AUTH_REQUIRED');
    // Public keys cannot read Supabase's OpenAPI root. Use our authenticated
    // same-origin endpoint; it returns only allowlisted form metadata.
    let response;
    try {
      response = await fetcher(`/api/tank-schema?operation=${operation}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch {
      throw new TankSetupError('Authenticated schema request failed', 'TANK_SCHEMA_UNAVAILABLE');
    }
    let result;
    try { result = await response.json(); } catch { throw new TankSetupError('Invalid schema response', 'TANK_SCHEMA_UNAVAILABLE'); }
    if (!response.ok) {
      const code = response.status === 401 ? 'TANK_AUTH_REQUIRED' : response.status === 403 ? 'TANK_ACCOUNT_NOT_ALLOWED' : result?.code;
      const failure = new TankSetupError('Server tank setup request rejected', /^TANK_[A-Z_]+$/.test(code || '') ? code : 'TANK_SCHEMA_UNAVAILABLE', Array.isArray(result?.fields) ? result.fields : []);
      failure.status = response.status;
      throw failure;
    }
    if (result?.userId !== user.id) throw new TankSetupError('Server and browser account mismatch', 'TANK_AUTH_REQUIRED');
    return { contract: publicTankContract(result.contract), user };
  }

  async function loadForEditing(id) {
    const { contract, user } = await inspectContract('edit');
    const { data, error } = await client.from(TABLES.TANKS).select('*')
      .eq(contract.primaryKey, id).eq(COLUMNS.USER_ID, user.id).single();
    if (error || !data || data.user_id !== user.id) throw new Error('This tank is unavailable or you do not have permission to edit it.');
    return { tank: data, contract, user };
  }

  async function save(plan, id = null) {
    const errors = validateTankPlan(plan);
    if (Object.keys(errors).length) throw new TankInputError(errors);
    // Recheck schema and verified auth on each write. Never accept an owner,
    // device reference, measured depth, or arbitrary database key from a form.
    const { contract, user } = await inspectContract(id ? 'edit' : 'create');
    const fieldErrors = validateContractFields(plan, contract);
    if (Object.keys(fieldErrors).length) throw new TankInputError(fieldErrors);
    const payload = {};
    for (const [field, column] of Object.entries(contract.fields)) {
      if (id && field === 'type') continue; // Preserve life stage/history on edit.
      const value = field === 'type' ? contract.typeValues[plan.type]
        : ['name', 'notes'].includes(field) ? String(plan[field] || '').trim()
        : planningNumber(plan[field]);
      payload[column] = value;
    }
    let query;
    if (id) {
      // Both filters are necessary even when RLS also enforces ownership.
      query = client.from(TABLES.TANKS).update(payload).eq(contract.primaryKey, id).eq(COLUMNS.USER_ID, user.id);
    } else {
      payload[COLUMNS.USER_ID] = user.id;
      if (contract.properties.is_paired) payload.is_paired = false;
      query = client.from(TABLES.TANKS).insert(payload);
    }
    const { data, error } = await query.select('*').single();
    if (error) throw error;
    if (!data || data.user_id !== user.id || !data[contract.primaryKey]) throw new Error('The tank could not be saved for your account. Please refresh before trying again.');
    return { tank: data, id: data[contract.primaryKey] };
  }

  return { inspectContract, loadForEditing, save };
}

export const tanksService = createTanksService({ client: supabase });
