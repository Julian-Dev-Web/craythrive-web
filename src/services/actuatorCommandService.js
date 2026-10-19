import { getSafeErrorMessage } from '../utils/securityDiagnostics.js';

const ordinaryCommands = new Set(['FEED_ONCE', 'REFILL_FOR', 'DRAIN_FOR', 'RESET_FEED_LOCK']);
const sourceMissing = error => ['42703', 'PGRST204'].includes(error?.code)
  && /\bcommand_source\b/i.test(String(error.message || ''));

// command_source describes an execution; it must not become a prerequisite for
// ordinary actuator requests while that optional schema is being rolled out.
// Probe with LIMIT 0 before the single INSERT. Never retry a physical command
// after a timeout, RLS rejection, safety rejection, or an uncertain response.
export async function insertActuatorCommand(client, payload) {
  if (!ordinaryCommands.has(payload?.command_type) || !payload.user_id || !payload.tank_id || !payload.device_uid
    || payload.command_status !== 'pending' || payload.status !== 'pending') {
    throw new Error('Invalid pending actuator request.');
  }
  const controller = new AbortController();
  let timer;
  let inserting = false;
  try {
    return await Promise.race([
      (async () => {
        const probe = await client.from('device_commands').select('command_source')
          .eq('user_id', payload.user_id).eq('tank_id', payload.tank_id).eq('device_uid', payload.device_uid)
          .limit(0).abortSignal(controller.signal);
        if (probe.error && !sourceMissing(probe.error)) throw probe.error;
        if (!probe.error && !Array.isArray(probe.data)) throw new Error('Command schema could not be verified.');
        if (controller.signal.aborted) throw new Error('Command verification timed out.');
        const body = { ...payload };
        if (probe.error) delete body.command_source;
        inserting = true;
        const { data, error } = await client.from('device_commands').insert(body).select('*').single().abortSignal(controller.signal);
        if (error) throw error;
        if (!data?.id || data.user_id !== payload.user_id || data.tank_id !== payload.tank_id
          || data.device_uid !== payload.device_uid || data.command_type !== payload.command_type) {
          throw new Error('The actuator request could not be verified. Refresh actuator state before retrying.');
        }
        return data;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(inserting
            ? 'The actuator request could not be confirmed. Refresh actuator state before retrying.'
            : 'Command verification timed out.'));
        }, 10000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function actuatorCommandErrorMessage(error, fallback) {
  if (error?.code === '55000') {
    if (/emergency stop|resume/i.test(String(error.message || ''))) return 'Emergency Stop is active. Confirm Stop and explicitly Resume Controls before another action.';
    if (/another.*(?:active|running)/i.test(String(error.message || ''))) return 'Another actuator action is still active. Refresh actuator state and wait for it to finish.';
  }
  if (sourceMissing(error)) return 'The command metadata schema changed. Refresh actuator state before retrying.';
  if (['PGRST202', '42883', '42703', 'PGRST204'].includes(error?.code)) return 'Actuator database setup is incomplete. Your request was not confirmed.';
  return getSafeErrorMessage(error, fallback);
}
