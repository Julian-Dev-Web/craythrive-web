import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationHistory, recommendationFingerprint, AI_HISTORY_LIMIT, AI_HISTORY_RETENTION_MS } from '../src/services/recommendationHistory.js';

const time = Date.parse('2026-10-13T02:00:00Z');
const entry = (id = 'entry', patch = {}) => ({ id, text: 'Inspect this tank and verify the measurement.', generatedAt: new Date(time).toISOString(), fingerprint: 'tank-state', ...patch });
function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: n => [...values.keys()][n], getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
}
test('saved explanations restore only for the matching user and tank without tokens or whole raw context', () => {
  const target = storage(), first = createRecommendationHistory(() => target);
  first.append('owner-a', 'tank-a', entry());
  const restored = createRecommendationHistory(() => target);
  assert.equal(restored.read('owner-a', 'tank-a', time)[0].text, entry().text);
  assert.deepEqual(restored.read('owner-b', 'tank-a', time), []);
  assert.deepEqual(restored.read('owner-a', 'tank-b', time), []);
  const context = { tank: { id: 'tank-a', user_id: 'owner-a' }, access_token: 'excluded',
    snapshot: { waterRecord: { reading: { id: 'row-a', raw_payload: { private: 'excluded' } } }, safety: { activeThresholds: { waterLevelMin: 3 } } } };
  const signature = recommendationFingerprint(context, [{ parameter: 'waterLevel', value: 3.05 }]);
  assert.doesNotMatch(signature, /access_token|raw_payload|excluded/);
  assert.notEqual(signature, recommendationFingerprint({ ...context, tank: { ...context.tank, id: 'tank-b' } }, []));
});
test('history is bounded, expires using trusted server time, and rejects malformed/future entries', () => {
  const target = storage(), store = createRecommendationHistory(() => target);
  for (let n = 0; n < 8; n++) store.append('owner', 'tank', entry(`entry-${n}`, { generatedAt: new Date(time + n).toISOString() }));
  assert.equal(store.read('owner', 'tank', time + 10).length, AI_HISTORY_LIMIT);
  assert.equal(store.read('owner', 'tank', time + 10)[0].id, 'entry-7');
  assert.deepEqual(store.read('owner', 'tank', null), []);
  assert.deepEqual(store.read('owner', 'tank', time + AI_HISTORY_RETENTION_MS + 10), []);
  assert.equal(target.length, 0);
  store.append('owner', 'tank', entry('future', { generatedAt: new Date(time + 5000).toISOString() }));
  assert.deepEqual(store.read('owner', 'tank', time), []);
  target.setItem('craythrive:ai-explanations:v1:owner:tank', '{invalid');
  assert.deepEqual(createRecommendationHistory(() => target).read('owner', 'tank', time), []);
});
test('blocked storage retains in-memory answers without crashing', () => {
  const store = createRecommendationHistory(() => { throw new Error('blocked'); });
  store.append('owner', 'tank', entry());
  assert.equal(store.read('owner', 'tank', time).length, 1);
  store.clear('owner');
  assert.deepEqual(store.read('owner', 'tank', time), []);
});
test('concurrent explicit requests deduplicate and preserve prior answers on later failure', async () => {
  const store = createRecommendationHistory(() => storage());
  let calls = 0, finish;
  const options = { ownerId: 'owner', tankId: 'tank', fingerprint: 'state-a', verifyOwner: async () => true,
    timestamp: async () => new Date(time).toISOString(), generate: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const a = store.run(options), b = store.run(options);
  assert.equal(a, b);
  await Promise.resolve(); await Promise.resolve();
  finish('First explanation'); await a;
  assert.equal(calls, 1);
  await assert.rejects(store.run({ ...options, generate: async () => { throw new Error('unavailable'); } }));
  assert.equal(store.read('owner', 'tank', time)[0].text, 'First explanation');
});
test('owner verification and logout cancellation prevent late answers being stored', async () => {
  const target = storage(), store = createRecommendationHistory(() => target);
  let calls = 0;
  const options = { ownerId: 'owner-a', tankId: 'tank', fingerprint: 'state-a',
    timestamp: async () => new Date(time).toISOString(), generate: async () => { calls++; return 'Answer'; } };
  await assert.rejects(store.run({ ...options, verifyOwner: async () => false }));
  assert.equal(calls, 0);
  let verified = 0;
  await assert.rejects(store.run({ ...options, verifyOwner: async () => ++verified === 1 }));
  assert.deepEqual(store.read('owner-a', 'tank', time), []);
  let finish;
  const request = store.run({ ...options, verifyOwner: async () => true, generate: () => new Promise(resolve => { finish = resolve; }) });
  await Promise.resolve(); await Promise.resolve();
  store.clear('owner-a'); finish('Late answer');
  await assert.rejects(request);
  assert.deepEqual(store.read('owner-a', 'tank', time), []);
});
test('clearing one account retains another account history', () => {
  const target = storage(), store = createRecommendationHistory(() => target);
  store.append('owner-a', 'tank', entry('a'));
  store.append('owner-b', 'tank', entry('b'));
  store.clear('owner-a');
  assert.deepEqual(store.read('owner-a', 'tank', time), []);
  assert.equal(store.read('owner-b', 'tank', time)[0].id, 'b');
});
