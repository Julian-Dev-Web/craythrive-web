// Advanced-juvenile pond grow-out reference, not a validated small-tank limit:
// https://www.business.qld.gov.au/industries/farms-fishing-forestry/fisheries/aquaculture/species/redclaw-crayfish
export const STOCKING_REFERENCE = Object.freeze({ juvenileLowPerM2: 5, juvenileUpperPerM2: 15 });
// CrayThrive planning preference, not a biological maximum or density rule.
export const BREEDER_GROUP = Object.freeze({ males: 1, females: 2 });
export const TANK_TYPES = Object.freeze(['juvenile', 'breeder']);

export function planningNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function calculateFloorAreaM2(lengthCm, widthCm) {
  const length = planningNumber(lengthCm), width = planningNumber(widthCm);
  if (!(length > 0) || !(width > 0)) return null;
  const area = (length / 100) * (width / 100);
  return Number.isFinite(area) && area > 0 ? area : null;
}

export function calculateWorkingVolumeLiters(lengthCm, widthCm, depthCm) {
  const area = calculateFloorAreaM2(lengthCm, widthCm), depth = planningNumber(depthCm);
  if (area === null || !(depth > 0)) return null;
  const volume = area * depth * 10;
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

export function getJuvenileStockingGuidance(areaM2) {
  const area = planningNumber(areaM2);
  if (!(area > 0)) return null;
  const low = Math.floor(area * STOCKING_REFERENCE.juvenileLowPerM2);
  const upper = Math.floor(area * STOCKING_REFERENCE.juvenileUpperPerM2);
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(upper)) return null;
  return { low, upper, beginner: low >= 1 ? low : null, belowReferenceArea: low < 1 };
}

export function getBreederStockingGuidance() {
  return { ...BREEDER_GROUP, groupSize: BREEDER_GROUP.males + BREEDER_GROUP.females,
    explanation: 'Suggested project group: 1 male + 2 females. No validated breeder density is configured; this is not a maximum capacity.' };
}

export function evaluatePlannedPopulation({ type, lengthCm, widthCm, population, shelters }) {
  const area = calculateFloorAreaM2(lengthCm, widthCm), count = planningNumber(population);
  const shelterCount = planningNumber(shelters);
  if (!TANK_TYPES.includes(type) || area === null || !Number.isSafeInteger(count) || count < 0) return null;
  const messages = [];
  if (type === 'juvenile') {
    const guidance = getJuvenileStockingGuidance(area);
    if (!guidance) return null;
    if (guidance.belowReferenceArea) messages.push('This tank is below the reference floor area. Review the setup and available shelters before stocking.');
    else if (count > guidance.upper) messages.push('Planned stocking is above the juvenile reference range. Review floor space, shelter, filtration, and monitoring before stocking.');
    else if (count > guidance.beginner) messages.push('Above the beginner starting estimate but within the reference range. Ensure adequate shelter, filtration, and close monitoring.');
  } else if (count > getBreederStockingGuidance().groupSize) {
    messages.push('More than one suggested breeding group is planned. Review floor space, animal size, individual shelters, and aggression; no validated breeder density is available.');
  }
  // Conservative project reminder only. Shelters never raise the area estimate.
  if (count > 0 && (shelterCount === null || shelterCount < count)) messages.push('Provide individual hiding areas and multiple shelters before stocking; the entered shelter count may be insufficient.');
  if (type === 'breeder' && !messages.length && count > 0) messages.push('Group size is within the suggested project grouping. Check usable floor space and individual shelters; this is not a capacity assessment.');
  const warning = messages.some(message => !message.startsWith('Group size is within'));
  return { severity: warning ? 'warning' : 'normal', densityPerM2: count / area,
    messages: messages.length ? messages : ['Planned stocking is within the conservative starting guidance.'] };
}

export function validateTankPlan(input) {
  const errors = {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.name = 'Enter a tank name.';
  if (!TANK_TYPES.includes(input.type)) errors.type = 'Choose Juvenile or Breeder.';
  for (const [key, label] of Object.entries({ lengthCm: 'Length', widthCm: 'Width', heightCm: 'Tank height', normalWaterDepthCm: 'Normal water depth' })) {
    if (!(planningNumber(input[key]) > 0)) errors[key] = `${label} must be a finite number greater than zero.`;
  }
  if (!errors.heightCm && !errors.normalWaterDepthCm && planningNumber(input.normalWaterDepthCm) > planningNumber(input.heightCm)) errors.normalWaterDepthCm = 'Normal water depth must not exceed tank height.';
  for (const [key, label] of Object.entries({ population: 'Crayfish count', shelters: 'Shelter count' })) {
    const number = planningNumber(input[key]);
    if (!Number.isSafeInteger(number) || number < 0) errors[key] = `${label} must be a whole number of zero or more.`;
  }
  if (!errors.lengthCm && !errors.widthCm && !errors.normalWaterDepthCm &&
    (calculateFloorAreaM2(input.lengthCm, input.widthCm) === null || calculateWorkingVolumeLiters(input.lengthCm, input.widthCm, input.normalWaterDepthCm) === null || !getJuvenileStockingGuidance(calculateFloorAreaM2(input.lengthCm, input.widthCm)))) errors.lengthCm = 'These dimensions are outside the supported calculation range.';
  return errors;
}

export function getTankPairingState(tank) {
  if (tank?.is_paired === false) return 'Unpaired';
  return tank?.device_uid || tank?.actuator_device_uid || tank?.iot_device_id
    ? 'Paired' : 'Unpaired';
}
