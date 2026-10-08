// Pairing is a neutral connection state, independent of water safety.
export function getTankPairingState(tank) {
  if (tank?.has_paired_device === true) return 'Paired';
  if (tank?.has_paired_device === false || tank?.is_paired === false) return 'Unpaired';
  return tank?.device_uid || tank?.actuator_device_uid || tank?.iot_device_id
    ? 'Paired' : 'Unpaired';
}
