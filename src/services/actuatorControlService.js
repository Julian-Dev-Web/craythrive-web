import { isCommandActive } from '../../supabase/functions/_shared/actuatorCommandLifecycle.js';

function verified(data, tankId, deviceUid, userId) {
  if (!data || data.tank_id !== tankId || data.device_uid !== deviceUid || typeof data.emergency_stop_active !== 'boolean'
    || !Array.isArray(data.active_commands)) throw new Error('Unverified actuator state');
  for (const row of [...data.active_commands, ...(data.terminal_commands || []), data.command, data.stop_command, data.resume_command].filter(Boolean)) {
    if (row.user_id !== userId || String(row.tank_id) !== String(tankId) || row.device_uid !== deviceUid) throw new Error('Unverified actuator scope');
  }
  return { ...data, active_commands: data.active_commands.filter(isCommandActive) };
}

async function call(client, name, { tankId, deviceUid, userId, commandId = null, action, signal }) {
  if (!tankId || !deviceUid || !userId) throw new Error('Select an owned paired actuator');
  const args = { p_tank_id: tankId, p_device_uid: deviceUid,
    ...(name === 'request_tank_emergency_control' ? { p_action: action } : { p_command_id: commandId }) };
  let request = client.rpc(name, args);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  request = request.abortSignal(controller.signal);
  let timer;
  let response;
  try {
    response = await Promise.race([request, new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Actuator request timed out')); }, 10000);
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  const { data, error } = response;
  if (error) throw error;
  return verified(data, tankId, deviceUid, userId);
}
export const loadActuatorControlState = (client, scope) => call(client, 'get_tank_actuator_control_state', scope);
export const requestEmergencyControl = (client, scope) => call(client, 'request_tank_emergency_control', scope);
export function actuatorControlError(error) {
  if (['PGRST202', '42883', '42703'].includes(error?.code)) return 'Emergency control setup needs the database migration. Controls remain locked until the state can be verified.';
  if (error?.code === '55000') return 'Controls are locked or another action is active. Refresh actuator state before retrying.';
  return 'Actuator command state could not be verified. Controls remain locked; reconnect and refresh actuator state.';
}
