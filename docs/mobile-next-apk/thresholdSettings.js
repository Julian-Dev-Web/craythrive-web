// Prepared adapter, NOT integrated into the missing Expo source tree.
// Copy the portable resolver into the mobile project and adjust this import.
import { fetchEffectiveTankThresholds } from '../../supabase/functions/_shared/thresholdResolution.js';

export const loadTankThresholdSettings = fetchEffectiveTankThresholds;

// Invoke only from a user-confirmed Apply action. The RPC performs ownership,
// field validation, scope handling and atomic auditing using auth.uid().
export async function applyTankThresholdSettings(client, tankId, patch, scope = 'single_tank') {
  if (!tankId) throw new Error('Select a tank before applying thresholds.');
  if (!['single_tank', 'all_tanks'].includes(scope)) throw new Error('Invalid threshold scope.');
  const { data, error } = await client.rpc('apply_tank_thresholds', {
    p_tank_id: tankId, p_patch: patch, p_scope: scope, p_source: 'manual',
  });
  if (error) throw error;
  return data;
}

// Requires the existing recommendation to have been stored against THIS tank.
// The actual mobile recommendation-storage path must be audited before wiring
// this adapter. Do not copy an account-wide pending suggestion to a guessed tank.
export async function applyPendingTankRecommendation(client, tankId) {
  if (!tankId) throw new Error('Tank context is required to accept this recommendation.');
  const { data, error } = await client.rpc('apply_tank_thresholds', {
    p_tank_id: tankId, p_patch: {}, p_scope: 'single_tank', p_source: 'ai_recommendation',
  });
  if (error) throw error;
  return data;
}
