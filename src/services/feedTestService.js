import { isPairedFeedActuator } from '../../supabase/functions/_shared/feederControl.js';
import { loadActuatorControlState } from './actuatorControlService';

export async function loadFeedTestState(client, tank, commandId = null) {
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth?.user?.id || auth.user.id !== tank?.user_id) throw new Error('Sign in to the account that owns this tank.');
  let query = client.from('iot_devices').select('*').eq('user_id', auth.user.id).eq('device_type', 'actuator_hub').eq('is_claimed', true);
  const pairedUid = tank.actuator_device_uid || tank.actuator_uid || tank.actuator_device;
  query = pairedUid ? query.eq('device_uid', pairedUid) : query.eq('tank_id', tank.id);
  const { data: devices, error } = await query;
  const device = !error && devices?.find(row => isPairedFeedActuator(row, tank, tank.id));
  if (!device) throw new Error('Connect a paired actuator to this tank before resetting its feed lock.');
  const scope = { tankId: tank.id, deviceUid: device.device_uid, userId: auth.user.id, commandId };
  return { scope, data: await loadActuatorControlState(client, scope) };
}

export async function queueFeedLockReset(client, scope) {
  const state = await loadActuatorControlState(client, scope);
  if (state.emergency_stop_active || state.active_commands.length) throw new Error('Wait for the active action or explicitly resume Emergency Stop before testing.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const { data, error } = await client.from('device_commands').insert({ user_id: scope.userId, tank_id: scope.tankId,
      device_uid: scope.deviceUid, command_type: 'RESET_FEED_LOCK', command_source: 'manual', command_value: 'reset',
      duration_ms: 0, command_status: 'pending', status: 'pending', result_message: 'Resetting feed test lock...' })
      .select('*').single().abortSignal(controller.signal);
    if (error) throw new Error('The reset request could not be confirmed. Refresh actuator state before retrying.');
    if (!data?.id || data.user_id !== scope.userId || data.tank_id !== scope.tankId || data.device_uid !== scope.deviceUid || data.command_type !== 'RESET_FEED_LOCK') throw new Error('The reset request could not be verified.');
    return data;
  } finally { clearTimeout(timeout); }
}
