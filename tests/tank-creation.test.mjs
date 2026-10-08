import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTankPayload, getDefaultTankPopulation, getTankPopulationLabel, parseJuvenileCount, validateTankForm } from '../src/utils/tankCreationRules.js';

const breeder = { name: ' Breeder Tank 1 ', type: 'breeder', notes: '' };
test('breeder fixed population cannot be overridden by form input', () => {
  assert.deepEqual(getDefaultTankPopulation('breeder', '999'), { male: 1, female: 2, juvenile: 0, total: 3 });
  const payload = buildTankPayload({ ...breeder, male_count: 200, female_count: 200, population: 200 }, 'owner');
  assert.deepEqual(payload, { user_id: 'owner', tank_name: 'Breeder Tank 1', tank_type: 'Breeder', male_count: 1, female_count: 2, juvenile_count: 0, notes: null, has_paired_device: false, status: 'Unpaired' });
});

test('juvenile defaults to 15, supports 20, and stores actual whole counters', () => {
  assert.equal(getDefaultTankPopulation('juvenile').juvenile, 15);
  for (const count of ['15', '20']) {
    const payload = buildTankPayload({ ...breeder, type: 'juvenile', juvenileCount: count }, 'owner');
    assert.equal(payload.tank_type, 'Juvenile'); assert.equal(payload.juvenile_count, Number(count));
    assert.equal(payload.male_count + payload.female_count, 0);
    assert.equal(getTankPopulationLabel(payload), `${count} juveniles`);
  }
});

test('fallback validates whole nonnegative SQL integers; recommendation is not an invented 15–20 constraint', () => {
  for (const value of ['', ' ', null, undefined, true, '15.5', '-1', 'abc', Infinity, '2147483648', '1e2', '0x10']) assert.equal(parseJuvenileCount(value), null, String(value));
  for (const value of ['0', '14', '15', '20', '21', '2147483647', '15.0']) assert.equal(parseJuvenileCount(value), Number(value));
  assert.ok(validateTankForm({ ...breeder, type: 'juvenile', juvenileCount: '' }).juvenileCount);
});

test('name is required, trims whitespace and rejects unsupported tank types', () => {
  assert.ok(validateTankForm({ ...breeder, name: '  ' }).name);
  for (const type of ['nursery', 'grow-out', 'other', 'Breeder', '__proto__']) assert.ok(validateTankForm({ ...breeder, type }).type);
  assert.throws(() => buildTankPayload(breeder, ''), /sign in/);
});

test('existing mobile-style rows display their stored counters without resetting populations', () => {
  assert.equal(getTankPopulationLabel({ tank_type: 'Breeder', male_count: 2, female_count: 4 }), '2 males + 4 females');
  assert.equal(getTankPopulationLabel({ tank_type: 'Juvenile', juvenile_count: 1 }), '1 juvenile');
  assert.equal(getTankPopulationLabel({ tank_type: 'Juvenile', population_label: 'unknown format' }), null);
  assert.equal(getTankPopulationLabel({}), null);
});
