import { supabase } from '../lib/supabase';
import { TABLES } from '../constants/schema';
import { buildTankPayload, TankFormError, validateTankForm } from '../utils/tankCreationRules';

function authError() {
  const error = new Error('Please sign in again before creating a tank. Your entries are still here.');
  error.code = 'TANK_AUTH_REQUIRED';
  return error;
}

export function createTanksService({ client }) {
  async function create(form) {
    const errors = validateTankForm(form);
    if (Object.keys(errors).length) throw new TankFormError(errors);
    if (!client) {
      const error = new Error('The dashboard connection is unavailable. Please contact support.');
      error.code = 'TANK_CONFIG_MISSING';
      throw error;
    }
    // Verify with Supabase Auth, then allowlist the shared table payload.
    // No schema endpoint, private key, trial insert, RPC or alternate table.
    const { data: auth, error: authFailure } = await client.auth.getUser();
    if (authFailure || !auth?.user?.id) throw authError();
    const payload = buildTankPayload(form, auth.user.id);
    const { data, error } = await client.from(TABLES.TANKS).insert(payload).select('*').single();
    if (error) throw error; // Existing RLS/constraints remain authoritative; never retry writes automatically.
    if (!data?.id || data.user_id !== auth.user.id || data.tank_type !== payload.tank_type ||
      data.male_count !== payload.male_count || data.female_count !== payload.female_count ||
      data.juvenile_count !== payload.juvenile_count || data.has_paired_device !== false) {
      const failure = new Error('Unable to confirm the created tank. Refresh your tanks before trying again.');
      failure.code = 'TANK_RESULT_UNCONFIRMED';
      throw failure;
    }
    return { tank: data, id: data.id };
  }
  return { create };
}

export const tanksService = createTanksService({ client: supabase });
