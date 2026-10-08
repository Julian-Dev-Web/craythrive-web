import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFloorAreaM2, calculateWorkingVolumeLiters, getJuvenileStockingGuidance,
  getBreederStockingGuidance, evaluatePlannedPopulation, validateTankPlan, getTankPairingState } from '../src/utils/tankStockingGuidance.js';
import { readTankPlan, resolveTankContract, TankSetupError } from '../src/utils/tankPlanningSchema.js';
import { tankSpec } from './fixtures/tank-schema.mjs';

const plan = { name: 'Test Tank', type: 'juvenile', lengthCm: 100, widthCm: 100, heightCm: 60, normalWaterDepthCm: 40, population: 5, shelters: 5 };

test('floor area, working volume, and requested juvenile examples', () => {
  assert.equal(calculateFloorAreaM2(100, 100), 1);
  assert.equal(calculateWorkingVolumeLiters(100, 100, 40), 400);
  assert.deepEqual(getJuvenileStockingGuidance(1), { low: 5, upper: 15, beginner: 5, belowReferenceArea: false });
  assert.deepEqual(getJuvenileStockingGuidance(calculateFloorAreaM2(200, 100)), { low: 10, upper: 30, beginner: 10, belowReferenceArea: false });
});

test('validation rejects incomplete/negative/nonfinite/fractional values and depth above height', () => {
  assert.deepEqual(validateTankPlan(plan), {});
  for (const invalid of ['', ' ', -1, 0, NaN, Infinity, 'NaN', false, [], null]) {
    assert.ok(validateTankPlan({ ...plan, lengthCm: invalid }).lengthCm, String(invalid));
  }
  assert.ok(validateTankPlan({ ...plan, normalWaterDepthCm: 61 }).normalWaterDepthCm);
  for (const population of [-1, 1.5, '', NaN, Infinity]) assert.ok(validateTankPlan({ ...plan, population }).population);
  assert.deepEqual(validateTankPlan({ ...plan, population: 0, shelters: 0 }), {});
  assert.ok(validateTankPlan({ ...plan, shelters: -1 }).shelters);
  assert.ok(validateTankPlan({ ...plan, type: 'craylings' }).type);
  assert.ok(validateTankPlan({ ...plan, name: ' ' }).name);
  assert.equal(calculateFloorAreaM2(1e308, 1e308), null);
});

test('stocking warnings never use Critical or increase density with extra shelters', () => {
  assert.equal(evaluatePlannedPopulation(plan).severity, 'normal');
  for (const population of [6, 15, 16, 100]) assert.equal(evaluatePlannedPopulation({ ...plan, population, shelters: 10000 }).severity, 'warning');
  assert.equal(evaluatePlannedPopulation({ ...plan, shelters: 0 }).severity, 'warning');
  assert.equal(getJuvenileStockingGuidance(.01).beginner, null);
  assert.equal(evaluatePlannedPopulation({ ...plan, lengthCm: 10, widthCm: 10 }).severity, 'warning');
  assert.equal(evaluatePlannedPopulation({ ...plan, population: '' }), null);
});

test('breeder project group is 1 male : 2 females with no juvenile density rule', () => {
  const group = getBreederStockingGuidance();
  assert.equal(group.males, 1); assert.equal(group.females, 2); assert.equal(group.groupSize, 3);
  assert.equal(evaluatePlannedPopulation({ ...plan, type: 'breeder', population: 3 }).severity, 'normal');
  assert.equal(evaluatePlannedPopulation({ ...plan, type: 'breeder', population: 4 }).severity, 'warning');
});

test('no device is Unpaired, and planned depth never falls back to measured depth or distance', () => {
  assert.equal(getTankPairingState({}), 'Unpaired');
  assert.equal(getTankPairingState({ is_paired: false, device_uid: null }), 'Unpaired');
  assert.equal(getTankPairingState({ is_paired: false, device_uid: 'reserved-device' }), 'Unpaired');
  assert.equal(getTankPairingState({ device_uid: 'device' }), 'Paired');
  assert.equal(readTankPlan({ water_depth_cm: 5, water_distance_cm: 20 }).normalWaterDepthCm, '');
  assert.equal(readTankPlan({ normal_water_depth_cm: 40, water_depth_cm: 5 }).normalWaterDepthCm, 40);
  assert.equal(readTankPlan({ population: 0, shelter_count: 0 }).population, 0);
});

test('schema resolver uses existing equivalents and rejects missing/ambiguous columns or device requirement', () => {
  const spec = tankSpec();
  const properties = spec.definitions.tanks.properties;
  properties.tank_name = properties.name; delete properties.name;
  spec.definitions.tanks.required = spec.definitions.tanks.required.map(key => key === 'name' ? 'tank_name' : key);
  properties.population = properties.crayfish_count; delete properties.crayfish_count;
  properties.tank_type.enum = ['Juvenile', 'Breeder'];
  const contract = resolveTankContract(spec);
  assert.equal(contract.fields.name, 'tank_name'); assert.equal(contract.fields.population, 'population');
  assert.equal(contract.typeValues.breeder, 'Breeder');
  properties.name = { type: 'string' };
  assert.throws(() => resolveTankContract(spec), TankSetupError);
  delete properties.name; delete properties.normal_water_depth_cm;
  properties.water_depth_cm = { type: 'number' };
  assert.throws(() => resolveTankContract(spec), TankSetupError);
  const requiredDevice = tankSpec(); requiredDevice.definitions.tanks.required.push('device_uid');
  assert.throws(() => resolveTankContract(requiredDevice), TankSetupError);
  const noOwner = tankSpec(); delete noOwner.definitions.tanks.properties.user_id;
  assert.throws(() => resolveTankContract(noOwner), TankSetupError);
});
