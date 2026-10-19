import { getRecordedActionStatus } from './actionStatus.js';

export const FEED_AMOUNTS = [
  { cycles: 1, label: 'Light' },
  { cycles: 2, label: 'Normal' },
  { cycles: 3, label: 'More' },
];

export function recordedDispenseCycles(value) {
  const number = typeof value === 'string' && /^[123]$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 && number <= 3 ? number : null;
}

export function normalizeDispenseCycles(value) { return recordedDispenseCycles(value) ?? 2; }
export function dispenseCycleLabel(cycles) { return `${cycles} dispense ${cycles === 1 ? 'cycle' : 'cycles'}`; }

// A completed servo command is the daily accounting signal, not proof of food
// delivery. Pending/running/rejected/failed requests never count as fed.
export function isCompletedFeedCommand(row) {
  return row?.command_type === 'FEED_ONCE' && row.command_status === 'done';
}

// A sensor hub or an unrelated actuator returned by a legacy lookup is never
// eligible for feeding. An explicit tank pairing may precede device.tank_id.
export function isPairedFeedActuator(device, tank, tankId) {
  const ownerId = tank?.user_id || tank?.owner_id;
  const pairedUid = tank?.actuator_device_uid || tank?.actuator_uid || tank?.actuator_device;
  return !!(device?.device_uid && device.device_type === 'actuator_hub' && device.is_claimed === true
    && ownerId && device.user_id === ownerId && tankId
    && (String(device.tank_id || '') === String(tankId)
      || !device.tank_id && pairedUid === device.device_uid));
}

// The caller supplies the saved status presentation outcome.
// Legacy values ("once", "auto", missing) cannot establish a cycle count.
export function formatRecordedFeedingAction(row, outcome) {
  if (!/feed/i.test(row?.command_type || row?.action_type || '')) return null;
  const cycles = recordedDispenseCycles(row.command_value ?? row.metadata?.dispense_cycles);
  const status = getRecordedActionStatus(row);
  const finalOutcome = ['blocked', 'rejected'].includes(status) ? 'Rejected' : outcome;
  const amount = cycles === null ? 'Dispense cycles were not recorded.' : `${dispenseCycleLabel(cycles)} requested.`;
  const states = {
    'Pending Verification': ['Feeding request sent', `${amount} Waiting for the actuator.`],
    'In Progress': ['Feeding in progress', `${amount} Waiting for completion confirmation.`],
    Requested: ['Feeding request sent', `${amount} Waiting for the actuator.`],
    Started: ['Feeding in progress', `${amount} Waiting for completion confirmation.`],
    Completed: ['Feeder command completed', `Feeder servo command sequence completed${cycles === null ? '.' : ` — ${dispenseCycleLabel(cycles)}.`} Physical feed delivery is not sensor-verified.`],
    Rejected: ['Feeding rejected', 'Feeding was blocked by a safety rule.'],
    Failed: ['Feeding failed', 'Feeding could not be completed.'],
    Skipped: ['Feeding skipped', 'Feeding was skipped. No successful completion is claimed.'],
  };
  const [title, message] = states[finalOutcome] || ['Feeding unconfirmed', 'Execution has not been confirmed.'];
  return { title, message, outcome: finalOutcome, cycles };
}
