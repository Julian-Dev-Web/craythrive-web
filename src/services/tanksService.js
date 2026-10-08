import { supabase } from '../lib/supabase';
import { TABLES, COLUMNS } from '../constants/schema';
import { resolveTankContract, TankSetupError, TankInputError, validateContractFields } from '../utils/tankPlanningSchema';
import { planningNumber, validateTankPlan } from '../utils/tankStockingGuidance';

export function createTanksService({ client, url, publicKey, fetcher = fetch }) {
  async function authenticatedUser() {
    if (!client) throw new Error('Please configure the dashboard connection and sign in before saving a tank.');
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user?.id) throw new Error('Please sign in again before saving a tank.');
    return data.user;
  }

  async function inspectContract() {
    const user = await authenticatedUser();
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token || !url || !publicKey) throw new TankSetupError('Authenticated schema inspection unavailable');
    // Standard authenticated PostgREST schema discovery; no private keys, RPCs,
    // migration execution, row sampling, or trial inserts.
    const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/`, { headers: {
      apikey: publicKey, Authorization: `Bearer ${data.session.access_token}`,
      Accept: 'application/openapi+json',
    } });
    if (!response.ok) throw new TankSetupError('The authenticated API schema is not accessible');
    return { contract: resolveTankContract(await response.json()), user };
  }

  async function loadForEditing(id) {
    const { contract, user } = await inspectContract();
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
    const { contract, user } = await inspectContract();
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

export const tanksService = createTanksService({ client: supabase,
  url: import.meta.env.VITE_SUPABASE_URL,
  publicKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
});
